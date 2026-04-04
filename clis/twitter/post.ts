import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../src/registry.js';
import { CommandExecutionError } from '../../src/errors.js';
import type { IPage } from '../../src/types.js';

const MAX_IMAGES = 4;
const UPLOAD_POLL_MS = 500;
const UPLOAD_TIMEOUT_MS = 30_000;
const SUPPORTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function validateImagePaths(raw: string): string[] {
  const paths = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (paths.length > MAX_IMAGES) {
    throw new CommandExecutionError(`Too many images: ${paths.length} (max ${MAX_IMAGES})`);
  }
  return paths.map(p => {
    const absPath = path.resolve(p);
    const ext = path.extname(absPath).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) {
      throw new CommandExecutionError(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
    }
    const stat = fs.statSync(absPath, { throwIfNoEntry: false } as any);
    if (!stat || !stat.isFile()) {
      throw new CommandExecutionError(`Not a valid file: ${absPath}`);
    }
    return absPath;
  });
}

cli({
  site: 'twitter',
  name: 'post',
  description: 'Post a new tweet/thread',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of the tweet' },
    { name: 'images', type: 'string', required: false, help: 'Image paths, comma-separated, max 4 (jpg/png/gif/webp)' },
  ],
  columns: ['status', 'message', 'text'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter post');

    // Validate images upfront before any browser interaction
    const absPaths = kwargs.images ? validateImagePaths(String(kwargs.images)) : [];

    // 1. Navigate to compose modal
    await page.goto('https://x.com/compose/tweet');
    await page.wait(3);

    // 2. Type the text via clipboard paste (handles newlines in Draft.js)
    const typeResult = await page.evaluate(`(async () => {
        try {
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (!box) return { ok: false, message: 'Could not find the tweet composer text area.' };
            box.focus();
            const dt = new DataTransfer();
            dt.setData('text/plain', ${JSON.stringify(kwargs.text)});
            box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
            return { ok: true };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);

    if (!typeResult.ok) {
      return [{ status: 'failed', message: typeResult.message, text: kwargs.text }];
    }

    // 3. Attach images if provided
    if (absPaths.length > 0) {
      if (!page.setFileInput) {
        throw new CommandExecutionError('Browser extension does not support file upload. Please update the extension.');
      }
      await page.setFileInput(absPaths, 'input[data-testid="fileInput"]');

      // Poll until attachments render and tweet button is enabled
      const pollIterations = Math.ceil(UPLOAD_TIMEOUT_MS / UPLOAD_POLL_MS);
      const uploaded = await page.evaluate(`(async () => {
          for (let i = 0; i < ${JSON.stringify(pollIterations)}; i++) {
              await new Promise(r => setTimeout(r, ${JSON.stringify(UPLOAD_POLL_MS)}));
              const container = document.querySelector('[data-testid="attachments"]');
              if (!container) continue;
              if (container.querySelectorAll('[role="group"]').length !== ${JSON.stringify(absPaths.length)}) continue;
              const btn = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
              if (btn && !btn.disabled) return true;
          }
          return false;
      })()`);

      if (!uploaded) {
        return [{ status: 'failed', message: `Image upload timed out (${UPLOAD_TIMEOUT_MS / 1000}s).`, text: kwargs.text }];
      }
    }

    // 4. Click the post button
    await page.wait(1);
    const result = await page.evaluate(`(async () => {
        try {
            const btn = document.querySelector('[data-testid="tweetButton"]') || document.querySelector('[data-testid="tweetButtonInline"]');
            if (btn && !btn.disabled) { btn.click(); return { ok: true, message: 'Tweet posted successfully.' }; }
            return { ok: false, message: 'Tweet button is disabled or not found.' };
        } catch (e) { return { ok: false, message: String(e) }; }
    })()`);

    if (result.ok) await page.wait(3);

    return [{ status: result.ok ? 'success' : 'failed', message: result.message, text: kwargs.text }];
  }
});
