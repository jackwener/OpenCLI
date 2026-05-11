import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseTweetUrl, buildTwitterArticleScopeSource } from './shared.js';

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
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const result = await page.evaluate(`(async () => {
        try {
            ${buildTwitterArticleScopeSource(target.id)}
            const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
            // Locate the article matching the requested status id, then find
            // its More menu. Without article scoping we'd grab whatever the
            // first "More" button on the page is — usually the parent tweet
            // (silent: hide the wrong reply, or fail silently if the parent
            // is not a reply you authored).
            let attempts = 0;
            let targetArticle = null;
            let moreMenu = null;

            while (attempts < 20) {
                targetArticle = findTargetArticle();
                if (targetArticle) {
                    const buttons = Array.from(targetArticle.querySelectorAll('button,[role="button"]'));
                    moreMenu = buttons.find((el) => visible(el) && (el.getAttribute('aria-label') || '').trim() === 'More');
                    if (moreMenu) break;
                }
                await new Promise(r => setTimeout(r, 500));
                attempts++;
            }

            if (!targetArticle) {
                return { ok: false, message: 'Could not find the requested reply article on this page.' };
            }
            if (!moreMenu) {
                return { ok: false, message: 'Could not find the "More" menu on the requested reply. Are you logged in?' };
            }

            moreMenu.click();
            await new Promise(r => setTimeout(r, 1000));

            // Look for the "Hide reply" menu item. Menu items render at the
            // document root, not inside the article — scope is the open menu.
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
