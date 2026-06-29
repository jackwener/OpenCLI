/**
 * 什么值得买好价详情 — browser cookie, DOM scraping.
 *
 * Resolves a deal id or URL to its detail page and extracts the headline
 * fields. Verified live against https://www.smzdm.com/p/<id>/ :
 *   - title  ← <h1>
 *   - price  ← .price-large (fallback .price)
 *   - buy_link ← outbound affiliate redirect (a[href*="go.smzdm.com"]); many
 *     informational deals have none, so it defaults to '' rather than dropping
 *     the column.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveDealUrl, unwrapEvaluateResult } from './shared.js';

const DETAIL_COLUMNS = ['id', 'title', 'price', 'buy_link', 'url'];

/** In-page extraction script for a smzdm deal detail page. */
export function buildSmzdmDetailJs() {
    return `
      (() => {
        const text = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const titleEl = document.querySelector('h1.item-name') || document.querySelector('h1');
        const title = text(titleEl);
        const priceEl = document.querySelector('.price-large') || document.querySelector('.price');
        const price = text(priceEl);
        // Outbound buy CTA — only present on deals with an affiliate link.
        // Restrict to the canonical smzdm redirect host so we never surface a
        // foreign URL.
        let buy_link = '';
        const buyEl = document.querySelector('a[href*="go.smzdm.com"]');
        if (buyEl) {
          try {
            const u = new URL(buyEl.href, location.href);
            if (u.protocol === 'https:' && u.hostname.toLowerCase() === 'go.smzdm.com') {
              buy_link = u.toString();
            }
          } catch {}
        }
        const m = location.pathname.match(/\\/p\\/([a-z0-9]+)\\//i);
        return { id: m ? m[1] : '', title, price, buy_link, url: location.href };
      })()
    `;
}

/** Fail closed unless the extractor returned a populated detail object. */
export function requireDetail(payload) {
    const row = unwrapEvaluateResult(payload);
    if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.title !== 'string') {
        throw new CommandExecutionError('Unexpected SMZDM detail extraction payload shape.');
    }
    if (!row.title) {
        throw new CommandExecutionError('Could not extract a title from the deal page; not a deal detail page or not logged in.');
    }
    return row;
}

export const smzdmDetailCommand = cli({
    site: 'smzdm',
    name: 'detail',
    access: 'read',
    description: '什么值得买好价详情（标题/价格/购买直达链接）',
    example: 'opencli smzdm detail 177316535 -f json',
    domain: 'www.smzdm.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'deal', required: true, positional: true, help: 'Deal id (e.g. 174854494) or full smzdm URL' },
    ],
    columns: DETAIL_COLUMNS,
    func: async (page, kwargs) => {
        const url = resolveDealUrl(kwargs.deal);
        await page.goto(url);
        return [requireDetail(await page.evaluate(buildSmzdmDetailJs()))];
    },
});

export const __test__ = { buildSmzdmDetailJs, requireDetail, DETAIL_COLUMNS };
