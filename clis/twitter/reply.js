import * as fs from 'node:fs';
import * as path from 'node:path';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, unwrapBrowserResult } from './shared.js';
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

function requireReplyActionResult(value, context) {
    const result = unwrapBrowserResult(value);
    if (!result || typeof result !== 'object' || Array.isArray(result) || typeof result.ok !== 'boolean') {
        throw new CommandExecutionError(`${context} returned a malformed result.`);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'message') && result.message != null && typeof result.message !== 'string') {
        throw new CommandExecutionError(`${context} returned a malformed message.`);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'url') && result.url != null && typeof result.url !== 'string') {
        throw new CommandExecutionError(`${context} returned a malformed status url.`);
    }
    return result;
}

function validateReplyStatusUrl(result) {
    if (!result.url) return;
    let url;
    try {
        url = new URL(result.url);
    } catch {
        throw new CommandExecutionError('Twitter reply completion returned a malformed status url.');
    }
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)\/?$/);
    if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(hostname) || !match) {
        throw new CommandExecutionError('Twitter reply completion returned a malformed status url.');
    }
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
        const clicked = requireReplyActionResult(await page.evaluate(`(() => {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const buttons = Array.from(document.querySelectorAll('[data-testid="reply"]'));
            const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
            if (!btn) return { ok: false, message: 'Could not find the reply button on the target tweet.' };
            btn.click();
            return { ok: true };
        })()`), 'Twitter target reply click');
        if (!clicked?.ok) return clicked;
        await page.wait({ selector: COMPOSER_SELECTOR, timeout: 15 });
        return { ok: true };
    }
}

async function insertReplyText(page, text) {
    return requireReplyActionResult(await page.evaluate(`(async () => {
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
  })()`), 'Twitter reply text insertion');
}

async function clickReplyButton(page) {
    const iterations = Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS);
    return requireReplyActionResult(await page.evaluate(`(async () => {
      try {
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
              const buttons = Array.from(
                  document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
              );
              const btn = buttons.find((el) => visible(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true');
              if (btn) {
                  for (const toast of Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))) {
                      if (visible(toast)) toast.setAttribute('data-opencli-before-reply-toast', 'true');
                  }
                  btn.click();
                  return { ok: true };
              }
              await new Promise(r => setTimeout(r, ${JSON.stringify(SUBMIT_POLL_MS)}));
          }
          return { ok: false, message: 'Reply button is disabled or not found.' };
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`), 'Twitter reply click');
}

async function detectReplySent(page) {
    const result = requireReplyActionResult(await page.evaluate(`(() => {
        const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
        const statusUrl = (root) => {
            if (!root || typeof root.querySelectorAll !== 'function') return undefined;
            const links = Array.from(root.querySelectorAll('a[href*="/status/"]'));
            for (const link of links) {
                const href = link.href || link.getAttribute('href') || '';
                if (!href) continue;
                try {
                    const url = new URL(href, window.location.origin);
                    const hostname = url.hostname.toLowerCase().replace(/^www\\./, '');
                    if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(hostname)) continue;
                    if (/^\\/([^/]+)\\/status\\/(\\d+)\\/?$/.test(url.pathname)) return url.href;
                } catch {}
            }
            return undefined;
        };
        const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
            .filter((el) => visible(el) && !el.hasAttribute('data-opencli-before-reply-toast'));
        const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
        if (!successToast) return { ok: false };
        return {
            ok: true,
            message: 'Reply posted successfully.',
            url: statusUrl(successToast)
        };
    })()`), 'Twitter reply success recovery');
    validateReplyStatusUrl(result);
    return result;
}

async function waitForReplySent(page, text) {
    const iterations = Math.ceil(SUBMIT_TIMEOUT_MS / SUBMIT_POLL_MS);
    try {
        const result = requireReplyActionResult(await page.evaluate(`(async () => {
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            const statusUrl = (root) => {
                if (!root || typeof root.querySelectorAll !== 'function') return undefined;
                const links = Array.from(root.querySelectorAll('a[href*="/status/"]'));
                for (const link of links) {
                    const href = link.href || link.getAttribute('href') || '';
                    if (!href) continue;
                    try {
                        const url = new URL(href, window.location.origin);
                        const hostname = url.hostname.toLowerCase().replace(/^www\\./, '');
                        if (!['x.com', 'twitter.com', 'mobile.twitter.com'].includes(hostname)) continue;
                        if (/^\\/([^/]+)\\/status\\/(\\d+)\\/?$/.test(url.pathname)) return url.href;
                    } catch {}
                }
                return undefined;
            };
            for (let i = 0; i < ${JSON.stringify(iterations)}; i++) {
                await new Promise(r => setTimeout(r, ${JSON.stringify(SUBMIT_POLL_MS)}));
                const toasts = Array.from(document.querySelectorAll('[role="alert"], [data-testid="toast"]'))
                    .filter((el) => visible(el) && !el.hasAttribute('data-opencli-before-reply-toast'));
                const successToast = toasts.find((el) => /sent|posted|your post was sent|your tweet was sent/i.test(el.textContent || ''));
                if (successToast) {
                    return {
                        ok: true,
                        message: 'Reply posted successfully.',
                        url: statusUrl(successToast)
                    };
                }
                const alert = toasts.find((el) => /failed|error|try again|not sent|could not/i.test(el.textContent || ''));
                if (alert) return { ok: false, message: (alert.textContent || 'Reply failed to post.').trim() };

                // Composer disappearance or text clearing alone can happen after
                // modal rewrites or failed submits. Require a fresh success toast.
            }
            return { ok: false, unconfirmed: true, message: 'Reply submission did not complete before timeout.' };
        })()`), 'Twitter reply completion');
        validateReplyStatusUrl(result);
        return result;
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
                throw new CommandExecutionError(composer?.message ?? 'Could not open the reply composer.', 'Open the tweet in the browser and check whether the reply box is available.');
            }
            if (localImagePath) {
                await page.wait({ selector: COMPOSER_FILE_INPUT_SELECTOR, timeout: 20 });
                await attachComposerImage(page, localImagePath);
            }
            const result = await submitReply(page, kwargs.text);
            if (result.unconfirmed) {
                throw new TimeoutError('twitter reply', SUBMIT_TIMEOUT_MS / 1000, `${result.message} Check the tweet before retrying; the reply may already be live.`);
            }
            if (!result.ok) {
                throw new CommandExecutionError(result.message, 'Nothing was posted. Open the tweet in the browser and retry.');
            }
            return [{
                    status: 'success',
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
