import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

function extractTweetId(url: string): string {
  let pathname = '';
  try {
    pathname = new URL(url).pathname;
  } catch {
    throw new Error(`Invalid tweet URL: ${url}`);
  }

  const match = pathname.match(/\/status\/(\d+)/);
  if (!match?.[1]) {
    throw new Error(`Could not extract tweet ID from URL: ${url}`);
  }

  return match[1];
}

function buildDeleteScript(tweetId: string): string {
  return `(async () => {
      try {
          const visible = (el) => !!el && (el.offsetParent !== null || el.getClientRects().length > 0);
          const tweetId = ${JSON.stringify(tweetId)};
          const targetArticle = Array.from(document.querySelectorAll('article')).find((article) =>
              Array.from(article.querySelectorAll('a[href*="/status/"]')).some((link) => {
                  try {
                      return new URL(link.href, window.location.origin).pathname.includes('/status/' + tweetId);
                  } catch {
                      return false;
                  }
              })
          );

          if (!targetArticle) {
              return { ok: false, message: 'Could not find the tweet card matching the requested URL.' };
          }

          const buttons = Array.from(targetArticle.querySelectorAll('button,[role="button"]'));
          const moreMenu = buttons.find((el) => visible(el) && (el.getAttribute('aria-label') || '').trim() === 'More');
          if (!moreMenu) {
              return { ok: false, message: 'Could not find the "More" context menu on the matched tweet. Are you sure you are logged in and looking at a valid tweet?' };
          }

          moreMenu.click();
          await new Promise(r => setTimeout(r, 1000));

          const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
          const deleteBtn = items.find((item) => {
              const text = (item.textContent || '').trim();
              return text.includes('Delete') && !text.includes('List');
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
  description: 'Delete a specific tweet by URL',
  domain: 'x.com',
  strategy: Strategy.UI, // Utilizes internal DOM flows for interaction
  browser: true,
  args: [
    { name: 'url', type: 'string', required: true, positional: true, help: 'The URL of the tweet to delete' },
  ],
  columns: ['status', 'message'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new CommandExecutionError('Browser session required for twitter delete');
    let tweetId = '';
    try {
      tweetId = extractTweetId(kwargs.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CommandExecutionError(message);
    }

    await page.goto(kwargs.url);
    await page.wait({ selector: '[data-testid="primaryColumn"]' }); // Wait for tweet to load completely

    const result = await page.evaluate(buildDeleteScript(tweetId));

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
  extractTweetId,
};
