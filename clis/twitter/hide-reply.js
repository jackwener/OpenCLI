import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'hide-reply',
    access: 'write',
    description: 'Hide a reply on your tweet (useful for hiding bot/spam replies)',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the reply tweet to hide' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter hide-reply');
        await page.goto(kwargs.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            let moreMenu = null;

            while (attempts < 20) {
                moreMenu = document.querySelector('[aria-label="More"]');
                if (moreMenu) break;
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!moreMenu) {
                return { ok: false, message: 'Could not find the "More" menu on this tweet. Are you logged in?' };
            }

            moreMenu.click();
            await new Promise(r => setTimeout(r, 1000));

            // Look for the "Hide reply" menu item
            const items = document.querySelectorAll('[role="menuitem"]');
            let hideItem = null;
            for (const item of items) {
                if (item.textContent && item.textContent.includes('Hide reply')) {
                    hideItem = item;
                    break;
                }
            }

            if (!hideItem) {
                return { ok: false, message: 'Could not find "Hide reply" option. This may not be a reply on your tweet.' };
            }

            hideItem.click();
            await new Promise(r => setTimeout(r, 1500));

            return { ok: true, message: 'Reply successfully hidden.' };
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);
        if (result.ok)
            await page.wait(2);
        return [{
                status: result.ok ? 'success' : 'failed',
                message: result.message
            }];
    }
});
