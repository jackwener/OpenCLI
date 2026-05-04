import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
const REPLY_FILE_INPUT_SELECTOR = 'input[type="file"][data-testid="fileInput"]';
const SUPPORTED_IMAGE_EXTENSIONS = new Set([
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
]);
const MAX_IMAGE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB (Twitter allows 5MB images, 15MB GIFs)
const CONTENT_TYPE_TO_EXTENSION = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
};
function resolveImagePath(imagePath) {
    const absPath = path.resolve(imagePath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`Image file not found: ${absPath}`);
    }
    const ext = path.extname(absPath).toLowerCase();
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(ext)) {
        throw new Error(`Unsupported image format "${ext}". Supported: jpg, jpeg, png, gif, webp`);
    }
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(`Image too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB)`);
    }
    return absPath;
}
function extractTweetId(url) {
    let pathname = '';
    try {
        pathname = new URL(url).pathname;
    }
    catch {
        throw new Error(`Invalid tweet URL: ${url}`);
    }
    const match = pathname.match(/\/status\/(\d+)/);
    if (!match?.[1]) {
        throw new Error(`Could not extract tweet ID from URL: ${url}`);
    }
    return match[1];
}
function buildReplyComposerUrl(url) {
    return `https://x.com/compose/post?in_reply_to=${extractTweetId(url)}`;
}
function resolveImageExtension(url, contentType) {
    const normalizedContentType = (contentType || '').split(';')[0].trim().toLowerCase();
    if (normalizedContentType && CONTENT_TYPE_TO_EXTENSION[normalizedContentType]) {
        return CONTENT_TYPE_TO_EXTENSION[normalizedContentType];
    }
    try {
        const pathname = new URL(url).pathname;
        const ext = path.extname(pathname).toLowerCase();
        if (SUPPORTED_IMAGE_EXTENSIONS.has(ext))
            return ext;
    }
    catch {
        // Fall through to the final error below.
    }
    throw new Error(`Unsupported remote image format "${normalizedContentType || 'unknown'}". ` +
        'Supported: jpg, jpeg, png, gif, webp');
}
async function downloadRemoteImage(imageUrl) {
    let parsed;
    try {
        parsed = new URL(imageUrl);
    }
    catch {
        throw new Error(`Invalid image URL: ${imageUrl}`);
    }
    if (!/^https?:$/.test(parsed.protocol)) {
        throw new Error(`Unsupported image URL protocol: ${parsed.protocol}`);
    }
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Image download failed: HTTP ${response.status}`);
    }
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (contentLength > MAX_IMAGE_SIZE_BYTES) {
        throw new Error(`Image too large: ${(contentLength / 1024 / 1024).toFixed(1)} MB (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB)`);
    }
    const ext = resolveImageExtension(imageUrl, response.headers.get('content-type'));
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-twitter-reply-'));
    const tmpPath = path.join(tmpDir, `image${ext}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_IMAGE_SIZE_BYTES) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        throw new Error(`Image too large: ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024} MB)`);
    }
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
}
async function attachReplyImage(page, absImagePath) {
    let uploaded = false;
    if (page.setFileInput) {
        try {
            await page.setFileInput([absImagePath], REPLY_FILE_INPUT_SELECTOR);
            uploaded = true;
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!msg.includes('Unknown action') && !msg.includes('not supported')) {
                throw new Error(`Image upload failed: ${msg}`);
            }
            // setFileInput not supported by extension — fall through to base64 fallback
        }
    }
    if (!uploaded) {
        const ext = path.extname(absImagePath).toLowerCase();
        const mimeType = ext === '.png'
            ? 'image/png'
            : ext === '.gif'
                ? 'image/gif'
                : ext === '.webp'
                    ? 'image/webp'
                    : 'image/jpeg';
        const base64 = fs.readFileSync(absImagePath).toString('base64');
        if (base64.length > 500_000) {
            console.warn(`[warn] Image base64 payload is ${(base64.length / 1024 / 1024).toFixed(1)}MB. ` +
                'This may fail with the browser bridge. Update the extension to v1.6+ for CDP-based upload, ' +
                'or compress the image before attaching.');
        }
        const upload = await page.evaluate(`
      (() => {
        const input = document.querySelector(${JSON.stringify(REPLY_FILE_INPUT_SELECTOR)});
        if (!input) return { ok: false, error: 'No file input found on page' };

        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const dt = new DataTransfer();
        const blob = new Blob([bytes], { type: ${JSON.stringify(mimeType)} });
        dt.items.add(new File([blob], ${JSON.stringify(path.basename(absImagePath))}, { type: ${JSON.stringify(mimeType)} }));

        Object.defineProperty(input, 'files', { value: dt.files, writable: false });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return { ok: true };
      })()
    `);
        if (!upload?.ok) {
            throw new Error(`Image upload failed: ${upload?.error ?? 'unknown error'}`);
        }
    }
    await page.wait(2);
    const uploadState = await page.evaluate(`
    (() => {
      const previewCount = document.querySelectorAll(
        '[data-testid="attachments"] img, [data-testid="attachments"] video, [data-testid="tweetPhoto"]'
      ).length;
      const hasMedia = previewCount > 0
        || !!document.querySelector('[data-testid="attachments"]')
        || !!Array.from(document.querySelectorAll('button,[role="button"]')).find((el) =>
          /remove media|remove image|remove/i.test((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || ''))
        );
      return { ok: hasMedia, previewCount };
    })()
  `);
    if (!uploadState?.ok) {
        throw new Error('Image upload failed: preview did not appear.');
    }
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
            throw new Error('Use either --image or --image-url, not both.');
        }
        let localImagePath;
        let cleanupDir;
        try {
            if (kwargs.image) {
                localImagePath = resolveImagePath(kwargs.image);
            }
            else if (kwargs['image-url']) {
                localImagePath = await downloadRemoteImage(kwargs['image-url']);
                cleanupDir = path.dirname(localImagePath);
            }
            // Dedicated composer is more reliable than the inline tweet page reply box.
            await page.goto(buildReplyComposerUrl(kwargs.url), { waitUntil: 'load', settleMs: 2500 });
            await page.wait({ selector: '[data-testid="tweetTextarea_0"]', timeout: 15 });
            if (localImagePath) {
                await page.wait({ selector: REPLY_FILE_INPUT_SELECTOR, timeout: 20 });
                await attachReplyImage(page, localImagePath);
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
        }
        finally {
            if (cleanupDir) {
                fs.rmSync(cleanupDir, { recursive: true, force: true });
            }
        }
    }
});
export const __test__ = {
    buildReplyComposerUrl,
    downloadRemoteImage,
    extractTweetId,
    resolveImageExtension,
    resolveImagePath,
};
