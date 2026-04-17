import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'follow',
    description: 'Follow a Twitter user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (without @)' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter follow');
        const username = kwargs.username.replace(/^@/, '');
        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            let attempts = 0;
            let followBtn = null;
            let unfollowTestId = null;

            while (attempts < 20) {
                // Check if already following (button shows screen_name-unfollow)
                unfollowTestId = document.querySelector('[data-testid$="-unfollow"]');
                if (unfollowTestId) {
                    return { ok: true, message: 'Already following @${username}.' };
                }

                // Look for the Follow button
                followBtn = document.querySelector('[data-testid$="-follow"]');
                if (followBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!followBtn) {
                return { ok: false, message: 'Could not find Follow button. Are you logged in?' };
            }

            followBtn.click();
            await new Promise(r => setTimeout(r, 1500));

            // Verify
            const verify = document.querySelector('[data-testid$="-unfollow"]');
            if (verify) {
                return { ok: true, message: 'Successfully followed @${username}.' };
            } else {
                return { ok: false, message: 'Follow action initiated but UI did not update.' };
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
