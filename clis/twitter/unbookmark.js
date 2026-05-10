import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';

cli({
    site: 'twitter',
    name: 'unbookmark',
    access: 'write',
    description: 'Remove a tweet from bookmarks',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', positional: true, required: true, help: 'Tweet URL to unbookmark' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter unbookmark');
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            let attempts = 0;
            let removeBtn = null;
            let targetArticle = null;

            while (attempts < 20) {
                targetArticle = findTargetArticle();
                // Check if not bookmarked (already removed)
                const bookmarkBtn = targetArticle?.querySelector('[data-testid="bookmark"]');
                if (bookmarkBtn) {
                    return { ok: true, message: 'Tweet is not bookmarked (already removed).' };
                }

                removeBtn = targetArticle?.querySelector('[data-testid="removeBookmark"]') || null;
                if (removeBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!removeBtn) {
                return { ok: false, message: 'Could not find Remove Bookmark button on the requested tweet. Are you logged in?' };
            }

            removeBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify
            const verifyArticle = findTargetArticle() || targetArticle;
            const verify = verifyArticle?.querySelector('[data-testid="bookmark"]');
            if (verify) {
                return { ok: true, message: 'Tweet successfully removed from bookmarks.' };
            } else {
                return { ok: false, message: 'Unbookmark action initiated but UI did not update.' };
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
