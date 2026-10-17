import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseTweetUrl, buildTwitterArticleScopeSource, unwrapBrowserResult } from './shared.js';

function buildDeleteScript(tweetId) {
    return `(async () => {
      try {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          // Layout metrics are the tie-breaker, never the gate: a caret that
          // has rendered reports offsetParent and one client rect even in a
          // hidden or minimized window, so an empty measurement almost always
          // means "not in the DOM yet" rather than "invisible". Elements that
          // report nothing are kept as a fallback below — they are already
          // scoped to the matched article, so there is no risk of grabbing a
          // neighbouring tweet's control.
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          ${buildTwitterArticleScopeSource(tweetId)}
          // The article's self-referential /status/<id> link can hydrate late on
          // slow networks, so poll findTargetArticle() for ~5s before giving up.
          let targetArticle = findTargetArticle();
          for (let i = 0; i < 20 && !targetArticle; i++) {
              await sleep(250);
              targetArticle = findTargetArticle();
          }

          if (!targetArticle) {
              return { ok: false, message: 'Could not find the tweet card matching the requested URL.' };
          }

          const belongsToTargetArticle = (el) => el.closest('article') === targetArticle;
          // X localizes the "More" caret aria-label (zh-Hans: 更多), so prefer the
          // language-agnostic data-testid and fall back to a multilingual label match.
          const findMoreMenu = () => {
              const carets = Array.from(targetArticle.querySelectorAll('[data-testid="caret"]')).filter(belongsToTargetArticle);
              const buttons = Array.from(targetArticle.querySelectorAll('button,[role="button"]')).filter(belongsToTargetArticle);
              const labelled = buttons.filter((el) => /^(More|更多)/.test((el.getAttribute('aria-label') || '').trim()));
              return carets.find(visible) || labelled.find(visible) || carets[0] || labelled[0] || null;
          };
          // The caret hydrates *after* the article: X paints the action bar
          // (reply/repost/like/bookmark/share) first and appends the caret last.
          // On a cold first call the gap is wide enough to lose: measured on a
          // real status page, a visible foreground window matched the article at
          // 0ms and only grew the caret at ~250ms, and a cold minimized one
          // matched at ~0.9s and grew the caret at ~1.9s. In both the caret was
          // absent from the whole document at check time, not merely unmeasurable.
          // A single-shot lookup here is what made the delete command fail on the
          // first invocation and succeed on an identical immediate retry, once the
          // page and the renderer are warm. Window mode does not decide it.
          let moreMenu = findMoreMenu();
          for (let i = 0; i < 20 && !moreMenu; i++) {
              await sleep(250);
              targetArticle = findTargetArticle() || targetArticle;
              moreMenu = findMoreMenu();
          }
          if (!moreMenu) {
              return { ok: false, message: 'Could not find the "More" context menu on the matched tweet. Are you sure you are logged in and looking at a valid tweet?' };
          }

          const beforeMenuItems = new Set(document.querySelectorAll('[role="menuitem"]'));
          moreMenu.click();

          // Wait for the action itself; unrelated rows can render much earlier.
          const findDeleteButton = () => {
              const items = Array.from(document.querySelectorAll('[role="menuitem"]'))
                  .filter((item) => !beforeMenuItems.has(item))
                  .filter((item) => {
                      const text = (item.textContent || '').trim();
                      return (text.includes('Delete') || text.includes('删除')) && !text.includes('List') && !text.includes('列表');
                  });
              return items.find(visible) || items[0] || null;
          };
          let deleteBtn = findDeleteButton();
          for (let i = 0; i < 20 && !deleteBtn; i++) {
              await sleep(250);
              deleteBtn = findDeleteButton();
          }

          if (!deleteBtn) {
              return { ok: false, message: 'The matched tweet menu did not contain Delete. This tweet may not belong to you.' };
          }

          deleteBtn.click();

          let confirmBtn = null;
          for (let i = 0; i < 20 && !confirmBtn; i++) {
              await sleep(250);
              confirmBtn = document.querySelector('[data-testid="confirmationSheetConfirm"]');
          }
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
export const __test__ = {
    buildDeleteScript,
};
