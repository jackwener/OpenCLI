import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'twitter',
  name: 'bookmark',
  description: 'Bookmark a tweet',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'url', type: 'string', positional: true, required: true, help: 'Tweet URL to bookmark' },
  ],
  columns: ['status', 'message'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter bookmark');

    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            let bookmarkBtn = null;
            let removeBtn = null;

            while (attempts < 20) {
                // Check if already bookmarked
                removeBtn = document.querySelector('[data-testid="removeBookmark"]');
                if (removeBtn) {
                    return { ok: true, message: 'Tweet is already bookmarked.' };
                }

                bookmarkBtn = document.querySelector('[data-testid="bookmark"]');
                if (bookmarkBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!bookmarkBtn) {
                return { ok: false, message: 'Could not find Bookmark button. Are you logged in?' };
            }

            bookmarkBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify
            const verify = document.querySelector('[data-testid="removeBookmark"]');
            if (verify) {
                return { ok: true, message: 'Tweet successfully bookmarked.' };
            } else {
                return { ok: false, message: 'Bookmark action initiated but UI did not update.' };
            }
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    if (result.ok) await page.wait(2);

    return [{
      status: result.ok ? 'success' : 'failed',
      message: result.message
    }];
  }
});
