import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'unblock',
    access: 'write',
    description: 'Unblock a Twitter user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (without @)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter unblock');
        const username = kwargs.username.replace(/^@/, '');
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            let unblockBtn = null;

            while (attempts < 20) {
                // Check if not blocked (follow button visible means not blocked)
                const followBtn = document.querySelector('[data-testid$="-follow"]');
                if (followBtn) {
                    return { ok: true, message: 'Not blocking @${username} (already unblocked).' };
                }

                unblockBtn = document.querySelector('[data-testid$="-unblock"]');
                if (unblockBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!unblockBtn) {
                return { ok: false, message: 'Could not find Unblock button. Are you logged in?' };
            }

            // Click the unblock button — this opens a confirmation dialog
            unblockBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Confirm the unblock in the dialog
            const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (confirmBtn) {
                confirmBtn.click();
                await new Promise(r => setTimeout(r, 1000));
            }

            // Verify
            const verify = document.querySelector('[data-testid$="-follow"]');
            if (verify) {
                return { ok: true, message: 'Successfully unblocked @${username}.' };
            } else {
                return { ok: false, message: 'Unblock action initiated but UI did not update.' };
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
