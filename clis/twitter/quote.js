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

async function openQuoteComposerFromRetweetMenu(page, target) {
    await page.goto(target.url, { waitUntil: 'load', settleMs: 2500 });
    await page.wait({ selector: '[data-testid="primaryColumn"]', timeout: 15 });
    const opened = await page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            let retweetBtn = null;
            let targetArticle = null;
            for (let i = 0; i < 20; i++) {
                targetArticle = findTargetArticle();
                retweetBtn = targetArticle?.querySelector('[data-testid="retweet"], [data-testid="unretweet"]') || null;
                if (retweetBtn && visible(retweetBtn)) break;
                await new Promise(r => setTimeout(r, 500));
            }
            if (!retweetBtn || !targetArticle) {
                return { ok: false, message: 'Could not find the repost menu button on the target tweet.' };
            }
            retweetBtn.click();

            let quoteItem = null;
            for (let i = 0; i < 20; i++) {
                await new Promise(r => setTimeout(r, 250));
                const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
                quoteItem = items.find((el) => visible(el) && /^Quote$/i.test((el.innerText || el.textContent || '').trim()));
                if (quoteItem) break;
            }
            if (!quoteItem) {
                return { ok: false, message: 'Repost menu opened but the Quote option did not appear.' };
            }
            quoteItem.click();
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);
    if (!opened?.ok) return opened;
    await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
    return { ok: true };
}

async function submitQuote(page, text, target, { allowMenuFallback = true } = {}) {
    return page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
            const insertTextIntoBox = async (box, value) => {
                box.focus();
                if (!document.execCommand('insertText', false, value)) {
                    const dataTransfer = new DataTransfer();
                    dataTransfer.setData('text/plain', value);
                    box.dispatchEvent(new ClipboardEvent('paste', {
                        clipboardData: dataTransfer,
                        bubbles: true,
                        cancelable: true,
                    }));
                }
                await new Promise(r => setTimeout(r, 1000));
                const actual = box.innerText || box.textContent || '';
                return normalize(actual).includes(normalize(value));
            };

            const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
            const box = boxes.find(visible) || boxes[0];
            if (!box) {
                return { ok: false, message: 'Could not find the quote composer text area. Are you logged in?' };
            }

            const textToInsert = ${JSON.stringify(text)};
            if (!(await insertTextIntoBox(box, textToInsert))) {
                return { ok: false, message: 'Could not verify quote text in the composer after typing.' };
            }

            // Confirm the quoted card is rendered before submitting. The
            // compose page does not wrap the card in an <article>, so we probe
            // the document for any link whose path exactly matches the
            // requested status id (uses __twHasLinkToTarget from
            // buildTwitterArticleScopeSource). If the dedicated compose URL
            // misses the card, the caller retries through the target post's
            // repost menu and Quote item.
            let cardAttempts = 0;
            let hasQuoteCard = false;
            while (cardAttempts < 20) {
                hasQuoteCard = __twHasLinkToTarget(document);
                if (hasQuoteCard) break;
                await new Promise(r => setTimeout(r, 250));
                cardAttempts++;
            }
            if (!hasQuoteCard) {
                const allowMenuFallback = ${JSON.stringify(allowMenuFallback)};
                if (allowMenuFallback) {
                    return { ok: false, retryWithMenuFallback: true, message: 'Quote target did not render in the dedicated composer; retrying through the repost menu.' };
                }
                return { ok: false, message: 'Quote target did not render after opening the quote composer from the repost menu.' };
            }

            let btn = null;
            for (let i = 0; i < 30; i++) {
                const buttons = Array.from(
                    document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
                );
                btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
                if (btn) break;
                await new Promise(r => setTimeout(r, 500));
            }
            if (!btn) {
                return { ok: false, message: 'Tweet button is disabled or not found.' };
            }

            btn.click();

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

            let result = await submitQuote(page, kwargs.text, target);
            if (result.retryWithMenuFallback) {
                const opened = await openQuoteComposerFromRetweetMenu(page, target);
                if (!opened?.ok) {
                    return [{ status: 'failed', message: opened?.message ?? 'Could not open quote composer from repost menu.', text: kwargs.text }];
                }
                if (localImagePath) {
                    await page.wait({ selector: COMPOSER_FILE_INPUT_SELECTOR, timeout: 20 });
                    await attachComposerImage(page, localImagePath);
                }
                result = await submitQuote(page, kwargs.text, target, { allowMenuFallback: false });
            }
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
