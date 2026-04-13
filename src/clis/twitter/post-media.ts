import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError } from '../../errors.js';
import fs from 'fs';
import path from 'path';
import type { IPage } from '../../types.js';

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

// Daemon has 1MB body limit; base64 expands 4/3x → 512KB binary ≈ 683KB base64
const CHUNK_SIZE = 512 * 1024;

cli({
  site: 'twitter',
  name: 'post-media',
  description: 'Post a tweet with an attached video or image',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', type: 'string', required: true, positional: true, help: 'Tweet text' },
    { name: 'media', type: 'string', required: true, help: 'Path to a local video or image file' },
  ],
  columns: ['status', 'tweet_id', 'message'],
  func: async (page: IPage | null, kwargs: Record<string, unknown>) => {
    if (!page) throw new CommandExecutionError('Browser session required');

    const filePath = path.resolve(kwargs.media as string);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext];
    if (!mimeType) {
      throw new CommandExecutionError(`Unsupported file type: ${ext}. Supported: ${Object.keys(MIME_TYPES).join(', ')}`);
    }

    const fileName = path.basename(filePath);
    let fileBuffer: Buffer;
    try {
      fileBuffer = fs.readFileSync(filePath);
    } catch {
      throw new CommandExecutionError(`File not found: ${filePath}`);
    }
    const totalChunks = Math.ceil(fileBuffer.length / CHUNK_SIZE);

    await page.goto('https://x.com/compose/tweet');
    await page.wait(3);

    const textResult = await page.evaluate(`(async () => {
      const box = document.querySelector('[data-testid="tweetTextarea_0"]');
      if (!box) return { ok: false, error: 'Tweet composer not found' };
      box.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', ${JSON.stringify(kwargs.text)});
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return { ok: true };
    })()`);

    if (!(textResult as { ok: boolean }).ok) {
      throw new CommandExecutionError((textResult as { error?: string }).error ?? 'Failed to enter tweet text');
    }

    await page.wait(1);

    await page.evaluate(`window.__mediaChunks = [];`);
    process.stdout.write(`  Reading file (${Math.round(fileBuffer.length / 1024 / 1024)}MB)...\n`);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = fileBuffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).toString('base64');
      await page.evaluate(`window.__mediaChunks.push(${JSON.stringify(chunk)});`);
      process.stdout.write(`\r  Buffering ${i + 1}/${totalChunks} chunks`);
    }
    process.stdout.write('\n');

    const mediaBtn = await page.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="attachments"]')
        || document.querySelector('input[type="file"]')?.closest('label')
        || Array.from(document.querySelectorAll('[role="button"]'))
            .find(el => el.getAttribute('aria-label')?.match(/media|photo|video|image/i));
      if (btn && btn.tagName !== 'INPUT') { btn.click(); return true; }
      return false;
    })()`);

    if (mediaBtn) await page.wait(1);

    const injectResult = await page.evaluate(`(async () => {
      try {
        const chunks = window.__mediaChunks;
        window.__mediaChunks = null;

        let totalLen = 0;
        const decoded = chunks.map(b64 => {
          const raw = atob(b64);
          const bytes = new Uint8Array(raw.length);
          for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
          totalLen += bytes.length;
          return bytes;
        });
        const all = new Uint8Array(totalLen);
        let offset = 0;
        for (const d of decoded) { all.set(d, offset); offset += d.length; }

        const blob = new Blob([all], { type: ${JSON.stringify(mimeType)} });
        const file = new File([blob], ${JSON.stringify(fileName)}, { type: ${JSON.stringify(mimeType)} });

        const input = Array.from(document.querySelectorAll('input[type="file"]'))
          .find(el => {
            const accept = el.getAttribute('accept') || '';
            return accept.includes('video') || accept.includes('image') || accept === '*';
          }) || document.querySelector('input[type="file"]');

        if (!input) return { ok: false, error: 'No file input found on page' };

        const dt = new DataTransfer();
        dt.items.add(file);
        Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));

        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    })()`);

    if (!(injectResult as { ok: boolean }).ok) {
      throw new CommandExecutionError(`Media inject failed: ${(injectResult as { error?: string }).error}`);
    }

    process.stdout.write('  Waiting for upload');
    await page.wait(3);
    for (let i = 0; i < 120; i++) {
      await page.wait(5);
      const state = await page.evaluate(`(() => {
        const uploading = document.querySelector(
          '[data-testid="attachments"] [role="progressbar"], ' +
          '[aria-label*="upload" i], [class*="upload"][class*="progress"]'
        );
        const postBtn = document.querySelector('[data-testid="tweetButton"], [data-testid="tweetButtonInline"]');
        const btnEnabled = postBtn && !postBtn.disabled && !postBtn.getAttribute('aria-disabled');
        return { uploading: !!uploading, btnEnabled: !!btnEnabled };
      })()`) as { uploading: boolean; btnEnabled: boolean };

      process.stdout.write('.');
      if (!state.uploading && state.btnEnabled) break;
    }
    process.stdout.write('\n');

    await page.wait(2);

    const postResult = await page.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="tweetButton"]')
        || document.querySelector('[data-testid="tweetButtonInline"]');
      if (!btn) return { ok: false, error: 'Post button not found' };
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
        return { ok: false, error: 'Post button still disabled — upload may not have completed' };
      }
      btn.click();
      return { ok: true };
    })()`);

    if (!(postResult as { ok: boolean }).ok) {
      throw new CommandExecutionError((postResult as { error?: string }).error ?? 'Failed to click post button');
    }

    await page.wait(4);

    const tweetId = await page.getCurrentUrl?.().then(url => {
      const m = url?.match(/\/status\/(\d+)/);
      return m?.[1] ?? '';
    }).catch(() => '') ?? '';

    return [{ status: 'success', tweet_id: tweetId, message: 'Tweet posted successfully' }];
  },
});
