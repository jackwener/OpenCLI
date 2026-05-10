import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';

cli({
    site: 'twitter',
    name: 'like',
    access: 'write',
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
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' }); // Wait for tweet to load completely
        const result = await page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            // Poll for the tweet to render. We scope state probes to the
            // article matching the requested status id — on conversation
            // pages multiple articles render and a bare querySelector would
            // grab the first one (silent: like the wrong tweet).
            let attempts = 0;
            let likeBtn = null;
            let unlikeBtn = null;
            let targetArticle = null;

            while (attempts < 20) {
                targetArticle = findTargetArticle();
                likeBtn = targetArticle?.querySelector('[data-testid="like"]') || null;
                unlikeBtn = targetArticle?.querySelector('[data-testid="unlike"]') || null;

                if (likeBtn || unlikeBtn) break;

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

            // Verify success by checking if the 'unlike' button reappeared
            const verifyArticle = findTargetArticle() || targetArticle;
            const verifyBtn = verifyArticle?.querySelector('[data-testid="unlike"]');
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
