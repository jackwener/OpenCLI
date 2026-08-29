import { CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';

cli({
    site: 'twitter',
    name: 'unlike',
    access: 'write',
    description: 'Remove a like from a specific tweet',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to unlike' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter unlike');
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        let writeStarted = false;
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            // Poll for the tweet to render. State probes scoped to the article
            // matching the requested status id — bare querySelector on a
            // conversation page would silently grab the first article (e.g.
            // the parent tweet) and unlike the wrong one.
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

            // Check if it's already not liked
            if (likeBtn) {
                return { ok: true, message: 'Tweet is not liked (already unliked).' };
            }

            if (!unlikeBtn) {
                return { ok: false, message: 'Could not find the Unlike button on this tweet after waiting 10 seconds. Are you logged in?' };
            }

            // Click Unlike
            writeStarted = true;
            unlikeBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify success by checking if the 'like' button reappeared
            const verifyArticle = findTargetArticle() || targetArticle;
            const verifyBtn = verifyArticle?.querySelector('[data-testid="like"]');
            if (verifyBtn) {
                return { ok: true, message: 'Tweet successfully unliked.' };
            } else {
                return { ok: false, unconfirmed: true, message: 'Unlike action was initiated but UI did not update as expected.' };
            }
        } catch (e) {
            return { ok: false, unconfirmed: writeStarted, message: e.toString() };
        }
    })()`);
        if (result.unconfirmed) {
            throw new TimeoutError('twitter unlike confirmation', 1, `${result.message} Check the tweet before retrying; the unlike may already have succeeded.`);
        }
        if (!result.ok) {
            throw new CommandExecutionError(result.message, 'Nothing changed. Open the tweet in the browser and retry.');
        }
        await page.wait(2);
        return [{
                status: 'success',
                message: result.message
            }];
    }
});
