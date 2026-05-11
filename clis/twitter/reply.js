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

function buildReplyComposerUrl(rawUrl) {
    // Replaces the legacy local extractTweetId which used `/\/status\/(\d+)/`
    // (silent: matched `/status/1234567` on substring `/status/123` and
    // accepted any host). parseTweetUrl bubbles ArgumentError on
    // malformed/off-domain inputs.
    const target = parseTweetUrl(rawUrl);
    return `https://x.com/compose/post?in_reply_to=${target.id}`;
}

async function submitReply(page, text) {
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

          const buttons = Array.from(
              document.querySelectorAll('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]')
          );
          const btn = buttons.find((el) => visible(el) && !el.disabled);
          if (!btn) {
              return { ok: false, message: 'Reply button is disabled or not found.' };
          }

          btn.click();
          return { ok: true, message: 'Reply posted successfully.' };
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`);
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
    columns: ['status', 'message', 'text'],
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
            // Dedicated composer is more reliable than the inline tweet page reply box.
            await page.goto(buildReplyComposerUrl(kwargs.url), { waitUntil: 'load', settleMs: 2500 });
            await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
            if (localImagePath) {
                await page.wait({ selector: COMPOSER_FILE_INPUT_SELECTOR, timeout: 20 });
                await attachComposerImage(page, localImagePath);
            }
            const result = await submitReply(page, kwargs.text);
            if (result.ok) {
                await page.wait(3); // Wait for network submission to complete
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
    buildReplyComposerUrl,
};
