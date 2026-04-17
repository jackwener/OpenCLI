import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'block',
    description: 'Block a Twitter user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (without @)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter block');
        const username = kwargs.username.replace(/^@/, '');
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;

            // Check if already blocked (profile shows "Blocked" / unblock button)
            while (attempts < 20) {
                const blockedIndicator = document.querySelector('[data-testid$="-unblock"]');
                if (blockedIndicator) {
                    return { ok: true, message: 'Already blocking @${username}.' };
                }

                const moreBtn = document.querySelector('[data-testid="userActions"]');
                if (moreBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            const moreBtn = document.querySelector('[data-testid="userActions"]');
            if (!moreBtn) {
                return { ok: false, message: 'Could not find user actions menu. Are you logged in?' };
            }

            // Open the more actions menu
            moreBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Find the Block menu item
            const menuItems = document.querySelectorAll('[role="menuitem"]');
            let blockItem = null;
            for (const item of menuItems) {
                if (item.textContent && item.textContent.includes('Block')) {
                    blockItem = item;
                    break;
                }
            }

            if (!blockItem) {
                return { ok: false, message: 'Could not find Block option in menu.' };
            }

            blockItem.click();
            await new Promise(r => setTimeout(r, 1000));

            // Confirm the block in the dialog
            const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (confirmBtn) {
                confirmBtn.click();
                await new Promise(r => setTimeout(r, 1500));
            }

            // Verify
            const verify = document.querySelector('[data-testid$="-unblock"]');
            if (verify) {
                return { ok: true, message: 'Successfully blocked @${username}.' };
            } else {
                return { ok: false, message: 'Block action initiated but UI did not update.' };
            }
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
