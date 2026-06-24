/**
 * 什么值得买好价打分（值 / 不值）— write op via the detail page rating widget.
 *
 * Verified live: the rating box is `.score_rateBox.J_score_rating` (id
 * `rating_<articleId>`); the 值 control is `.details_zhi` (#details-zhi) and 不值
 * is `.details_buzhi`. Clicking 值 bumps the up count (verified 0→1 on a fresh
 * deal). smzdm does NOT expose a reliable per-account "已打分" state in the
 * static DOM — the `.scoredInfo` overlay stays hidden even after rating — so the
 * only trustworthy confirmation is the up-count incrementing. We therefore
 * report success only when the count moves; a stale count is surfaced as an
 * honest "couldn't confirm (likely already rated)" rather than a false success.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveDealUrl } from './shared.js';

export const smzdmZhiCommand = cli({
    site: 'smzdm',
    name: 'zhi',
    access: 'write',
    description: '给一条好价打分：值（默认）或不值（--down）（需登录）',
    example: 'opencli smzdm zhi 177316535',
    domain: 'www.smzdm.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'deal', required: true, positional: true, help: 'Deal id (e.g. 174854494) or full smzdm URL' },
        { name: 'down', type: 'bool', default: false, help: 'Vote 不值 instead of 值' },
    ],
    columns: ['status', 'vote', 'message'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required for smzdm zhi');
        const url = resolveDealUrl(kwargs.deal);
        const down = kwargs.down === true || kwargs.down === 'true';
        const vote = down ? '不值' : '值';
        await page.goto(url);
        await page.wait({ selector: '.score_rateBox, .J_score_rating, .details_zhi' });
        const result = await page.evaluate(`(async () => {
          try {
            const down = ${down};
            const box = document.querySelector('.J_score_rating') || document.querySelector('.score_rateBox') || document;
            // Already rated → visible "已打分" overlay.
            const scored = box.querySelector('.scoredInfo');
            if (scored && scored.offsetParent !== null) {
              return { ok: true, message: 'Deal is already rated by this account.' };
            }
            const btn = down
              ? (box.querySelector('.details_buzhi') || document.querySelector('#details-buzhi'))
              : (box.querySelector('.details_zhi') || document.querySelector('#details-zhi'));
            if (!btn) {
              return { ok: false, message: 'Could not find the rating button. Not a deal page or not logged in?' };
            }
            const countEl = () => box.querySelector(down ? '.grey' : '.red');
            const readCount = () => {
              const el = countEl();
              const n = el ? parseInt((el.textContent || '').replace(/[^0-9]/g, ''), 10) : NaN;
              return Number.isFinite(n) ? n : null;
            };
            const before = readCount();
            btn.click();
            for (let i = 0; i < 16; i++) {
              await new Promise((r) => setTimeout(r, 250));
              const after = readCount();
              const nowScored = box.querySelector('.scoredInfo');
              if ((before != null && after != null && after > before) || (nowScored && nowScored.offsetParent !== null)) {
                return { ok: true, message: 'Rated ' + (down ? '不值' : '值') + '.' };
              }
            }
            // smzdm surfaces no reliable per-account "已打分" state on load, so a
            // missing count bump usually means the deal was already rated by this
            // account (a harmless server-side no-op) rather than a hard failure.
            return { ok: false, message: 'Vote sent but the up-count did not change within 4s — the deal may already be rated by this account (smzdm exposes no reliable on-load rated state).' };
          } catch (e) {
            return { ok: false, message: e.toString() };
          }
        })()`);
        if (result.ok) {
            await page.wait(1);
        }
        return [{ status: result.ok ? 'success' : 'failed', vote, message: result.message }];
    },
});
