import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

cli({
  site: 'twitter',
  name: 'delete',
  description: 'Delete a specific tweet by URL',
  domain: 'x.com',
  strategy: Strategy.UI, // Utilizes internal DOM flows for interaction
  browser: true,
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to delete' },
  ],
  columns: ['status', 'message'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new Error('Requires browser');

    await page.goto(kwargs.url);
    await page.wait(5); // Wait for tweet to load completely

    const result = await page.evaluate(`(async () => {
        try {
            // Wait for caret button (which has 'More' aria-label) within the main tweet body
            // Getting the first 'More' usually corresponds to the main displayed tweet of the URL
            const moreMenu = document.querySelector('[aria-label="More"]');
            if (!moreMenu) {
                return { ok: false, message: 'Could not find the "More" context menu on this tweet. Are you sure you are logged in and looking at a valid tweet?' };
            }

            // Click the 'More' 3 dots button to open the dropdown menu
            moreMenu.click();
            await new Promise(r => setTimeout(r, 1000));
            
            // Wait for dropdown pop-out to appear and look for the 'Delete' option
            const items = document.querySelectorAll('[role="menuitem"]');
            let deleteBtn = null;
            for (const item of items) {
                if (item.textContent.includes('Delete') && !item.textContent.includes('List')) {
                    deleteBtn = item;
                    break;
                }
            }
            
            if (!deleteBtn) {
                // If there's no Delete button, it's not our tweet OR localization is not English.
                // Assuming English default for now.
                return { ok: false, message: 'This tweet does not seem to belong to you, or the Delete option is missing (not your tweet).' };
            }

            // Click Delete
            deleteBtn.click();
            await new Promise(r => setTimeout(r, 1000));
            
            // Find and click the confirmation 'Delete' prompt inside the modal
            const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (confirmBtn) {
                confirmBtn.click();
                return { ok: true, message: 'Tweet successfully deleted.' };
            } else {
                return { ok: false, message: 'Delete confirmation dialog did not appear.' };
            }
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    if (result.ok) {
        // Wait for the deletion request to be processed
        await page.wait(2);
    }

    return [{
        status: result.ok ? 'success' : 'failed',
        message: result.message
    }];
  }
});
