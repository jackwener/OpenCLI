import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';

cli({
    site: 'twitter',
    name: 'bookmark',
    access: 'write',
    description: 'Bookmark a tweet',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'url', type: 'string', positional: true, required: true, help: 'Tweet URL to bookmark' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter bookmark');
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            // Article-scoped: on conversation pages multiple bookmark/remove
            // buttons render and a bare querySelector would silently bookmark
            // a different tweet (e.g. the parent of the requested reply).
            let attempts = 0;
            let bookmarkBtn = null;
            let removeBtn = null;
            let targetArticle = null;

            while (attempts < 20) {
                targetArticle = findTargetArticle();
                removeBtn = targetArticle?.querySelector('[data-testid="removeBookmark"]') || null;
                if (removeBtn) {
                    return { ok: true, message: 'Tweet is already bookmarked.' };
                }

                bookmarkBtn = targetArticle?.querySelector('[data-testid="bookmark"]') || null;
                if (bookmarkBtn) break;

                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!bookmarkBtn) {
                return { ok: false, message: 'Could not find Bookmark button on the requested tweet. Are you logged in?' };
            }

            bookmarkBtn.click();
            await new Promise(r => setTimeout(r, 1000));

            // Verify
            const verifyArticle = findTargetArticle() || targetArticle;
            const verify = verifyArticle?.querySelector('[data-testid="removeBookmark"]');
            if (verify) {
                return { ok: true, message: 'Tweet successfully bookmarked.' };
            } else {
                return { ok: false, message: 'Bookmark action initiated but UI did not update.' };
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
