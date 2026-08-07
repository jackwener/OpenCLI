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

          if (!targetArticle) {
              return { ok: false, message: 'Could not find the tweet card matching the requested URL.' };
          }

          const belongsToTargetArticle = (el) => el.closest('article') === targetArticle;
          const buttons = Array.from(targetArticle.querySelectorAll('button,[role="button"]')).filter(belongsToTargetArticle);
          // X localizes the "More" caret aria-label (zh-Hans: 更多), so prefer the
          // language-agnostic data-testid and fall back to a multilingual label match.
          const moreMenu = Array.from(targetArticle.querySelectorAll('[data-testid="caret"]')).filter(belongsToTargetArticle).find(visible)
              || buttons.find((el) => visible(el) && /^(More|更多)/.test((el.getAttribute('aria-label') || '').trim()));
          if (!moreMenu) {
              return { ok: false, message: 'Could not find the "More" context menu on the matched tweet. Are you sure you are logged in and looking at a valid tweet?' };
          }

          const beforeMenuItems = new Set(document.querySelectorAll('[role="menuitem"]'));
          moreMenu.click();
          await new Promise(r => setTimeout(r, 1000));

          const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
              .filter((item) => visible(item) && !beforeMenuItems.has(item));
          const deleteBtn = items.find((item) => {
              const text = (item.textContent || '').trim();
              // X localizes the menu item (zh-Hans: 删除); exclude the "Add/remove
              // from Lists" item in both languages so we never click the wrong row.
              return (text.includes('Delete') || text.includes('删除')) && !text.includes('List') && !text.includes('列表');
          });

          if (!deleteBtn) {
              return { ok: false, message: 'The matched tweet menu did not contain Delete. This tweet may not belong to you.' };
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
