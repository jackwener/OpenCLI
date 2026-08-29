import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
cli({
    site: 'twitter',
    name: 'unfollow',
    access: 'write',
    description: 'Unfollow a Twitter user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (without @)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter unfollow');
        const username = kwargs.username.replace(/^@/, '');
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        let writeStarted = false;
        try {
            let attempts = 0;
            let unfollowBtn = null;

            while (attempts < 20) {
                // Check if already not following
                const followBtn = document.querySelector('[data-testid$="-follow"]');
                if (followBtn) {
                    return { ok: true, message: 'Not following @${username} (already unfollowed).' };
                }

                unfollowBtn = document.querySelector('[data-testid$="-unfollow"]');
                if (unfollowBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!unfollowBtn) {
                return { ok: false, message: 'Could not find Unfollow button. Are you logged in?' };
            }

            // Click the unfollow button — this opens a confirmation dialog
            unfollowBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Confirm the unfollow in the dialog
            const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
            if (!confirmBtn) {
                return { ok: false, message: 'Unfollow confirmation dialog did not appear.' };
            }
            writeStarted = true;
            confirmBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify
            const verify = document.querySelector('[data-testid$="-follow"]');
            if (verify) {
                return { ok: true, message: 'Successfully unfollowed @${username}.' };
            } else {
                return { ok: false, unconfirmed: true, message: 'Unfollow action initiated but UI did not update.' };
            }
        } catch (e) {
            return { ok: false, unconfirmed: writeStarted, message: e.toString() };
        }
    })()`);
        if (result.unconfirmed) {
            throw new TimeoutError('twitter unfollow confirmation', 1, `${result.message} Check the profile before retrying; the unfollow may already have succeeded.`);
        }
        if (!result.ok) {
            throw new CommandExecutionError(result.message, 'Nothing changed. Open the profile in the browser and retry.');
        }
        await page.wait(2);
        return [{
                status: 'success',
                message: result.message
            }];
    }
});
