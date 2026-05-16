import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl } from './shared.js';
import {
    COMPOSER_FILE_INPUT_SELECTOR,
    attachComposerImage,
    downloadRemoteImage,
    resolveImagePath,
} from './utils.js';

const COMPOSER_SELECTOR = '[data-testid="tweetTextarea_0"]';
const SUBMIT_POLL_MS = 500;
const SUBMIT_TIMEOUT_MS = 15_000;

function buildReplyComposerUrl(rawUrl) {
    // Replaces the legacy local extractTweetId which used `/\/status\/(\d+)/`
    // (silent: matched `/status/1234567` on substring `/status/123` and
    // accepted any host). parseTweetUrl bubbles ArgumentError on
    // malformed/off-domain inputs.
    const target = parseTweetUrl(rawUrl);
    return `https://x.com/compose/post?in_reply_to=${target.id}`;
}

function isPromiseCollectedError(err) {
    const msg = err instanceof Error ? err.message : String(err);
    return msg.includes('Promise was collected');
}

async function openReplyComposer(page, rawUrl) {
    await page.goto(buildReplyComposerUrl(rawUrl), { waitUntil: 'load', settleMs: 2500 });
    try {
        await page.wait({ selector: COMPOSER_SELECTOR, timeout: 15 });
        return { ok: true };
    } catch {
        // X sometimes leaves /compose/post?in_reply_to=<id> on the Home
        // timeline behind a loading dialog. Fall back to the canonical tweet
        // page and click the visible Reply action there.
        await page.goto(rawUrl, { waitUntil: 'load', settleMs: 2500 });
        const clicked = await page.evaluate(`(() => {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const buttons = Array.from(document.querySelectorAll('[data-testid="reply"]'));
            const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) return { ok: false, message: 'Could not find the reply button on the target tweet.' };
            btn.click();
            return { ok: true };
        })()`);
        if (!clicked?.ok) return clicked;
        await page.wait({ selector: COMPOSER_SELECTOR, timeout: 15 });
        return { ok: true };
    }
}

async function insertReplyText(page, text) {
    return page.evaluate(`(async () => {
      try {
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]'));
          const box = boxes.find(visible) || boxes[0];
          if (!box) {
              return { ok: false, message: 'Could not find the reply text area. Are you logged in?' };
          }

          box.focus();
          const textToInsert = ${JSON.stringify(text)};
          // execCommand('insertText') is more reliable with Twitter's Draft.js editor
          if (!document.execCommand('insertText', false, textToInsert)) {
              // Fallback to paste event if execCommand fails
              const dataTransfer = new DataTransfer();
              dataTransfer.setData('text/plain', textToInsert);
              box.dispatchEvent(new ClipboardEvent('paste', {
                  clipboardData: dataTransfer,
                  bubbles: true,
                  cancelable: true
              }));
          }

          await new Promise(r => setTimeout(r, 1000));
          const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
          const actual = box.innerText || box.textContent || '';
          if (!normalize(actual).includes(normalize(textToInsert))) {
              return { ok: false, message: 'Could not verify reply text in the composer after typing.', actualText: actual };
          }
          return { ok: true };
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`);
}

async function clickReplyButton(page) {
    return page.evaluate(`(() => {
      try {
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          const buttons = Array.from(
              document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
          );
          const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
          if (!btn) {
              return { ok: false, message: 'Reply button is disabled or not found.' };
          }

          btn.click();
          return { ok: true };
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`);
}

async function detectReplySent(page) {
    return page.evaluate(`(() => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
            .filter((el) => visible(el));
        const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
        if (!successToast) return { ok: false };
        const link = successToast.querySelector('a[href*="/status/"]');
        return {
            ok: true,
            message: 'Reply posted successfully.',
            url: link?.href || link?.getAttribute('href') || undefined
        };
    })()`);
}

async function waitForReplySent(page, text) {
    const iterations = Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS);
    try {
        return await page.evaluate(`(async () => {
            const expected = ${JSON.stringify(text)};
            const normalize = s => String(s || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
            const expectedText = normalize(expected);
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
                await new Promise(r => setTimeout(r, ${JSON.stringify(SUBMIT_POLL_MS)}));
                const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
                    .filter((el) => visible(el));
                const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
                if (successToast) {
                    const link = successToast.querySelector('a[href*="/status/"]');
                    return {
                        ok: true,
                        message: 'Reply posted successfully.',
                        url: link?.href || link?.getAttribute('href') || undefined
                    };
                }
                const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
                if (alert) return { ok: false, message: (alert.textContent || 'Reply failed to post.').trim() };

                const boxes = Array.from(document.querySelectorAll('[data-testid="tweetTextarea_0"]')).filter(visible);
                const composerStillHasText = boxes.some((box) => normalize(box.innerText || box.textContent || '').includes(expectedText));
                if (!composerStillHasText) return { ok: true, message: 'Reply posted successfully.' };
            }
            return { ok: false, message: 'Reply submission did not complete before timeout.' };
        })()`);
    } catch (err) {
        // X may route the SPA immediately after click, making CDP collect the
        // polling promise even though the reply was submitted. If the page now
        // shows the success toast, report success instead of a false negative.
        if (!isPromiseCollectedError(err)) throw err;
        await page.wait(2);
        const recovered = await detectReplySent(page);
        if (recovered?.ok) return recovered;
        throw err;
    }
}

async function submitReply(page, text) {
    const typed = await insertReplyText(page, text);
    if (!typed?.ok) return typed;
    let clicked;
    try {
        clicked = await clickReplyButton(page);
    } catch (err) {
        if (!isPromiseCollectedError(err)) throw err;
    }
    if (clicked && !clicked.ok) return clicked;
    return waitForReplySent(page, text);
}

cli({
    site: 'twitter',
    name: 'reply',
    access: 'write',
    description: 'Reply to a specific tweet, optionally with a local or remote image',
    domain: 'x.com',
    strategy: Strategy.UI, // Uses the UI directly to input and click post
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to reply to' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of your reply' },
        { name: 'image', help: 'Optional local image path to attach to the reply' },
        { name: 'image-url', help: 'Optional remote image URL to download and attach to the reply' },
    ],
    columns: ['status', 'message', 'text', 'url'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter reply');
        if (kwargs.image && kwargs['image-url']) {
            throw new CommandExecutionError('Use either --image or --image-url, not both.');
        }
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
            // Dedicated composer is normally more reliable than the inline
            // tweet page reply box, but X occasionally leaves that route on the
            // Home timeline behind a loading dialog. openReplyComposer falls
            // back to the target tweet's visible Reply action.
            const composer = await openReplyComposer(page, kwargs.url);
            if (!composer?.ok) {
                return [{ status: 'failed', message: composer?.message ?? 'Could not open the reply composer.', text: kwargs.text }];
            }
            if (localImagePath) {
                await page.wait({ selector: COMPOSER_FILE_INPUT_SELECTOR, timeout: 20 });
                await attachComposerImage(page, localImagePath);
            }
            const result = await submitReply(page, kwargs.text);
            return [{
                    status: result.ok ? 'success' : 'failed',
                    message: result.message,
                    text: kwargs.text,
                    ...(result.url ? { url: result.url } : {}),
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
    buildReplyComposerUrl,
    isPromiseCollectedError,
};
