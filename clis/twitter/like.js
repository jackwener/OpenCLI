import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'twitter',
    name: 'like',
    description: 'Like a specific tweet',
    domain: 'x.com',
    strategy: Strategy.UI, // Utilizes internal DOM flows for interaction
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to like' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter like');
        await page.goto(kwargs.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' }); // Wait for tweet to load completely
        const result = await page.evaluate(`(async () => {
        try {
            // Poll for the tweet to render
            let attempts = 0;
            let likeBtn = null;
            let unlikeBtn = null;
            
            while (attempts < 20) {
                unlikeBtn = document.querySelector('[data-testid="unlike"]');
                likeBtn = document.querySelector('[data-testid="like"]');
                
                if (unlikeBtn || likeBtn) break;
                
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            // Check if it's already liked
            if (unlikeBtn) {
                return { ok: true, message: 'Tweet is already liked.' };
            }

            if (!likeBtn) {
                return { ok: false, message: 'Could not find the Like button on this tweet after waiting 10 seconds. Are you logged in?' };
            }

            // Click Like
            likeBtn.click();
            await new Promise(r => setTimeout(r, 1000));
            
            // Verify success by checking if the 'unlike' button appeared
            const verifyBtn = document.querySelector('[data-testid="unlike"]');
            if (verifyBtn) {
                return { ok: true, message: 'Tweet successfully liked.' };
            } else {
                return { ok: false, message: 'Like action was initiated but UI did not update as expected.' };
            }
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);
        if (result.ok) {
            // Wait for the like network request to be processed
            await page.wait(2);
        }
        return [{
                status: result.ok ? 'success' : 'failed',
                message: result.message
            }];
    }
});
