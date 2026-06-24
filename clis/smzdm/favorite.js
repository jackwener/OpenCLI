/**
 * 什么值得买收藏好价 — write op via the detail page's collect button.
 *
 * Verified live: the collect control is `div.fav.J_zhi_like_fav` (carries
 * `data-article`); clicking it adds the `active` class and bumps the count.
 * Idempotent like `twitter like` — re-running on an already-collected deal
 * reports success without double-acting.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveDealUrl } from './shared.js';

export const smzdmFavoriteCommand = cli({
    site: 'smzdm',
    name: 'favorite',
    access: 'write',
    description: '收藏一条好价（需登录）',
    example: 'opencli smzdm favorite 177316535',
    domain: 'www.smzdm.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'deal', required: true, positional: true, help: 'Deal id (e.g. 174854494) or full smzdm URL' },
    ],
    columns: ['status', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for smzdm favorite');
        const url = resolveDealUrl(kwargs.deal);
        await page.goto(url);
        await page.wait({ selector: '.fav.J_zhi_like_fav' });
        const result = await page.evaluate(`(async () => {
          try {
            const btn = document.querySelector('.fav.J_zhi_like_fav');
            if (!btn) {
              return { ok: false, message: 'Could not find the favorite button. Not a deal page or not logged in?' };
            }
            const isFaved = (el) => el.classList.contains('active') || el.classList.contains('faved') || el.classList.contains('on');
            if (isFaved(btn)) {
              return { ok: true, message: 'Deal is already favorited.' };
            }
            btn.click();
            // Poll for the active class / count bump to confirm the write landed.
            for (let i = 0; i < 16; i++) {
              await new Promise((r) => setTimeout(r, 250));
              const now = document.querySelector('.fav.J_zhi_like_fav');
              if (now && isFaved(now)) {
                return { ok: true, message: 'Deal favorited.' };
              }
            }
            return { ok: false, message: 'Favorite click was sent but the UI did not confirm within 4s.' };
          } catch (e) {
            return { ok: false, message: e.toString() };
          }
        })()`);
        if (result.ok) {
            await page.wait(1);
        }
        return [{ status: result.ok ? 'success' : 'failed', message: result.message }];
    },
});
