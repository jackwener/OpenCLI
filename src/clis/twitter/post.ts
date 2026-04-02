import * as fs from 'node:fs';
import * as path from 'node:path';

import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

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

    // 1. Navigate directly to the compose tweet modal
    await page.goto('https://x.com/compose/tweet');
    await page.wait(3); // Wait for the modal and React app to hydrate

    // 2. Type the text
    const typeResult = await page.evaluate(`(async () => {
        try {
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (!box) return { ok: false, message: 'Could not find the tweet composer text area.' };
            box.focus();
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', ${JSON.stringify(kwargs.text)});
            box.dispatchEvent(new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true,
                cancelable: true
            }));
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    if (!typeResult.ok) {
      return [{ status: 'failed', message: typeResult.message, text: kwargs.text }];
    }

    // 3. Attach images if provided
    if (kwargs.images) {
      const imagePaths = String(kwargs.images).split(',').map((s: string) => s.trim()).filter(Boolean);

      if (imagePaths.length > 4) {
        throw new CommandExecutionError(`Too many images: ${imagePaths.length} (max 4)`);
      }

      const absPaths = imagePaths.map((p: string) => {
        const absPath = path.resolve(p);
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
          throw new CommandExecutionError(`Not a valid file: ${absPath}`);
        }
        return absPath;
      });

      if (!page.setFileInput) {
        throw new CommandExecutionError('Browser extension does not support file upload. Please update the extension.');
      }
      try {
        await page.setFileInput(absPaths, 'input[data-testid="fileInput"]');
      } catch (e) {
        throw new CommandExecutionError(`Failed to attach images: ${e}`);
      }

      // Poll until image upload completes (tweet button becomes enabled) or timeout
      const uploaded = await page.evaluate(`(async () => {
          for (let i = 0; i < 20; i++) {
              await new Promise(r => setTimeout(r, 1000));
              const btn = document.querySelector('[data-testid="tweetButton"]');
              if (btn && !btn.disabled) return true;
              const inlineBtn = document.querySelector('[data-testid="tweetButtonInline"]');
              if (inlineBtn && !inlineBtn.disabled) return true;
          }
          return false;
      })()`);

      if (!uploaded) {
        return [{ status: 'failed', message: 'Image upload timed out (20s).', text: kwargs.text }];
      }
    }

    // 4. Click the post button
    await page.wait(1);
    const result = await page.evaluate(`(async () => {
        try {
            const btn = document.querySelector('[data-testid="tweetButton"]');
            if (btn && !btn.disabled) {
                btn.click();
                return { ok: true, message: 'Tweet posted successfully.' };
            }
            const inlineBtn = document.querySelector('[data-testid="tweetButtonInline"]');
            if (inlineBtn && !inlineBtn.disabled) {
                inlineBtn.click();
                return { ok: true, message: 'Tweet posted successfully.' };
            }
            return { ok: false, message: 'Tweet button is disabled or not found.' };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    if (result.ok) {
        await page.wait(3);
    }

    return [{
        status: result.ok ? 'success' : 'failed',
        message: result.message,
        text: kwargs.text
    }];
  }
});
