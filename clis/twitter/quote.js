import * as fs from 'node:fs';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';
import {
    COMPOSER_FILE_INPUT_SELECTOR,
    attachComposerImage,
    downloadRemoteImage,
    resolveImagePath,
} from './utils.js';

function buildQuoteComposerUrl(url) {
    // Twitter/X quote-tweet compose URL: the `url` param attaches the source
    // tweet as a quoted card. Validating tweet-id shape early surfaces obvious
    // typos before any browser interaction.
    const parsed = parseTweetUrl(url);
    return `https://x.com/compose/post?url=${encodeURIComponent(parsed.url)}`;
}

async function submitQuote(page, text, tweetId) {
    return page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(tweetId)}
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
            const box = boxes.find(visible) || boxes[0];
            if (!box) {
                return { ok: false, message: 'Could not find the quote composer text area. Are you logged in?' };
            }

            box.focus();
            const textToInsert = ${JSON.stringify(text)};
            // execCommand('insertText') is more reliable with Twitter's Draft.js editor.
            if (!document.execCommand('insertText', false, textToInsert)) {
                // Fallback to paste event if execCommand fails.
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', textToInsert);
                box.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true,
                }));
            }

            await new Promise(r => setTimeout(r, 1000));

            // Confirm the quoted card is rendered before submitting; otherwise
            // we may accidentally post a plain tweet without the quote
            // attachment. The compose page does not wrap the card in an
            // <article>, so we probe the document for any link whose path
            // exactly matches the requested status id (uses __twHasLinkToTarget
            // from buildTwitterArticleScopeSource).
            let cardAttempts = 0;
            let hasQuoteCard = false;
            while (cardAttempts < 20) {
                hasQuoteCard = __twHasLinkToTarget(document);
                if (hasQuoteCard) break;
                await new Promise(r => setTimeout(r, 250));
                cardAttempts++;
            }
            if (!hasQuoteCard) {
                return { ok: false, message: 'Quote target did not render in the composer. The source tweet may be deleted or restricted.' };
            }

            const buttons = Array.from(
                document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
            );
            const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) {
                return { ok: false, message: 'Tweet button is disabled or not found.' };
            }

            btn.click();

            const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
            const expectedText = normalize(textToInsert);
            for (let i = 0; i < 30; i++) {
                await new Promise(r => setTimeout(r, 500));
                const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
                    .filter((el) => visible(el));
                const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
                if (successToast) return { ok: true, message: 'Quote tweet posted successfully.' };
                const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
                if (alert) return { ok: false, message: (alert.textContent || 'Quote tweet failed to post.').trim() };

                const visibleBoxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
                const composerStillHasText = visibleBoxes.some((box) =>
                    normalize(box.innerText || box.textContent || '').includes(expectedText)
                );
                if (!composerStillHasText) return { ok: true, message: 'Quote tweet posted successfully.' };
            }
            return { ok: false, message: 'Quote tweet submission did not complete before timeout.' };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);
}

cli({
    site: 'twitter',
    name: 'quote',
    access: 'write',
    description: 'Quote-tweet a specific tweet with your own text, optionally with a local or remote image',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to quote' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of your quote' },
        { name: 'image', help: 'Optional local image path to attach to the quote tweet' },
        { name: 'image-url', help: 'Optional remote image URL to download and attach to the quote tweet' },
    ],
    columns: ['status', 'message', 'text'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter quote');
        if (kwargs.image && kwargs['image-url']) {
            throw new CommandExecutionError('Use either --image or --image-url, not both.');
        }

        // Validate URL (typed ArgumentError on malformed/off-domain inputs)
        // before any browser interaction or remote image download.
        const target = parseTweetUrl(kwargs.url);

        let localImagePath;
        let cleanupDir;
        try {
            if (kwargs.image) {
                localImagePath = resolveImagePath(kwargs.image);
            } else if (kwargs['image-url']) {
                const downloaded = await downloadRemoteImage(kwargs['image-url']);
                localImagePath = downloaded.absPath;
                cleanupDir = downloaded.cleanupDir;
            }

            // Dedicated composer is more reliable than the inline quote-tweet button.
            await page.goto(`https://x.com/compose/post?url=${encodeURIComponent(target.url)}`, { waitUntil: 'load', settleMs: 2500 });
            await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });

            if (localImagePath) {
                await page.wait({ selector: COMPOSER_FILE_INPUT_SELECTOR, timeout: 20 });
                await attachComposerImage(page, localImagePath);
            }

            const result = await submitQuote(page, kwargs.text, target.id);
            if (result.ok) {
                // Wait for network submission to complete
                await page.wait(3);
            }
            return [{
                    status: result.ok ? 'success' : 'failed',
                    message: result.message,
                    text: kwargs.text,
                    ...(kwargs.image ? { image: kwargs.image } : {}),
                    ...(kwargs['image-url'] ? { 'image-url': kwargs['image-url'] } : {}),
                }];
        } finally {
            if (cleanupDir) {
                fs.rmSync(cleanupDir, { recursive: true, force: true });
            }
        }
    }
});

export const __test__ = {
    buildQuoteComposerUrl,
};
