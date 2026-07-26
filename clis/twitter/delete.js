import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseTweetUrl, buildTwitterArticleScopeSource, unwrapBrowserResult } from './shared.js';

function buildDeleteScript(tweetId) {
    return `(async () => {
      try {
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          ${buildTwitterArticleScopeSource(tweetId)}
          // The article's self-referential /status/<id> link can hydrate late on
          // slow networks, so poll findTargetArticle() for ~5s before giving up.
          let targetArticle = findTargetArticle();
          for (let i = 0; i < 20 && !targetArticle; i++) {
              await new Promise(r => setTimeout(r, 250));
              targetArticle = findTargetArticle();
          }

          // The focal tweet on a status detail page has no self-permalink (its
          // timestamp is plain text), so findTargetArticle can miss it. Fall
          // back to probing every visible caret; only the caller's own tweet
          // exposes a Delete item, so opening the wrong menu is harmless — we
          // dismiss it and move on.
          const belongsToTargetArticle = (el) => targetArticle && el.closest('article') === targetArticle;
          const carets = Array.from(document.querySelectorAll('article [data-testid="caret"]')).filter(visible);
          carets.sort((a, b) => (belongsToTargetArticle(b) ? 1 : 0) - (belongsToTargetArticle(a) ? 1 : 0));
          if (!carets.length) {
              return { ok: false, message: 'Could not find the "More" context menu on the matched tweet. Are you sure you are logged in and looking at a valid tweet?' };
          }

          const findDeleteItem = (items) => items.find((item) => {
              const text = (item.textContent || '').trim();
              // X localizes the menu item (zh-Hans: 删除); exclude the "Add/remove
              // from Lists" item in both languages so we never click the wrong row.
              return (text.includes('Delete') || text.includes('删除')) && !text.includes('List') && !text.includes('列表');
          });

          let deleteBtn = null;
          for (const caret of carets) {
              const beforeMenuItems = new Set(document.querySelectorAll('[role="menuitem"]'));
              caret.click();
              await new Promise(r => setTimeout(r, 800));
              const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
                  .filter((item) => visible(item) && !beforeMenuItems.has(item));
              deleteBtn = findDeleteItem(items);
              if (deleteBtn) break;
              document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
              await new Promise(r => setTimeout(r, 400));
          }

          if (!deleteBtn) {
              return { ok: false, message: 'No opened menu contained Delete. This tweet may not belong to you.' };
          }

          deleteBtn.click();
          await new Promise(r => setTimeout(r, 1000));

          const confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          if (confirmBtn) {
              confirmBtn.click();
              return { ok: true, message: 'Tweet successfully deleted.' };
          } else {
              return { ok: false, message: 'Delete confirmation dialog did not appear.' };
          }
      } catch (e) {
          return { ok: false, message: e.toString() };
      }
  })()`;
}
cli({
    site: 'twitter',
    name: 'delete',
    access: 'write',
    description: 'Delete a specific tweet by URL',
    domain: 'x.com',
    strategy: Strategy.UI, // Utilizes internal DOM flows for interaction
    browser: true,
    args: [
        { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to delete' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for twitter delete');
        // parseTweetUrl throws ArgumentError on malformed/off-domain inputs —
        // this replaces the ad-hoc local extractTweetId which only checked
        // the path shape and accepted any host (silent: would try to act on
        // attacker-controlled redirect URLs).
        const target = parseTweetUrl(kwargs.url);
        await page.goto(target.url);
        await page.wait({ selector: '[data-testid="primaryColumn"]' }); // Wait for tweet to load completely
        const result = unwrapBrowserResult(await page.evaluate(buildDeleteScript(target.id)));
        if (result.ok) {
            // Wait for the deletion request to be processed
            await page.wait(2);
        }
        return [{
                status: result.ok ? 'success' : 'failed',
                message: result.message
            }];
    }
});
export const __test__ = {
    buildDeleteScript,
};
