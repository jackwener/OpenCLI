import { CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'twitter',
  name: 'unbookmark',
  description: 'Remove a tweet from bookmarks',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'url', type: 'string', positional: true, required: true, help: 'Tweet URL to unbookmark' },
  ],
  columns: ['status', 'message'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter unbookmark');

    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            let removeBtn = null;

            while (attempts < 20) {
                // Check if not bookmarked
                const bookmarkBtn = document.querySelector('[data-testid="bookmark"]');
                if (bookmarkBtn) {
                    return { ok: true, message: 'Tweet is not bookmarked (already removed).' };
                }

                removeBtn = document.querySelector('[data-testid="removeBookmark"]');
                if (removeBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!removeBtn) {
                return { ok: false, message: 'Could not find Remove Bookmark button. Are you logged in?' };
            }

            removeBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify
            const verify = document.querySelector('[data-testid="bookmark"]');
            if (verify) {
                return { ok: true, message: 'Tweet successfully removed from bookmarks.' };
            } else {
                return { ok: false, message: 'Unbookmark action initiated but UI did not update.' };
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
