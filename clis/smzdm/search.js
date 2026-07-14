/**
 * 什么值得买搜索好价 — browser cookie, DOM scraping.
 *
 * Fix: The old adapter used `search.smzdm.com/ajax/` which returns 404.
 * New approach: navigate to `search.smzdm.com/?c=home&s=<keyword>&v=b`
 * and scrape the rendered DOM directly.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

function requireSearchRows(payload) {
    const rows = unwrapEvaluateResult(payload);
    if (!Array.isArray(rows)) {
        throw new CommandExecutionError('Unexpected SMZDM search extraction payload shape; expected an array of rows.');
    }
    return rows;
}

function parseLimit(raw) {
    let parsed;
    if (raw == null) {
        parsed = 20;
    }
    else if (typeof raw === 'number') {
        parsed = raw;
    }
    else if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
        parsed = Number(raw);
    }
    else {
        parsed = NaN;
    }
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between 1 and 100, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1 || parsed > 100) {
        throw new ArgumentError(`--limit must be between 1 and 100, got ${parsed}`);
    }
    return parsed;
}

/**
 * Build the in-page extraction script. Every result row carries the full
 * declared column set; interaction metrics default to 0 and the update time
 * to '' when a list item omits them, so no column is ever silently dropped.
 */
function buildSmzdmSearchJs(limit) {
    return `
      (() => {
        const limit = ${limit};
        const items = document.querySelectorAll('li.feed-row-wide');
        const results = [];
        const normalizeCount = (text) => {
          const raw = (text || '').replace(/,/g, '').trim();
          const match = raw.match(/(\\d+(?:\\.\\d+)?)\\s*([万kK]?)/);
          if (!match) return 0;
          const base = Number(match[1]);
          if (!Number.isFinite(base)) return 0;
          const unit = match[2];
          if (unit === '万') return Math.round(base * 10000);
          if (unit === 'k' || unit === 'K') return Math.round(base * 1000);
          return Math.round(base);
        };
        const intFrom = (el) => {
          if (!el) return 0;
          return normalizeCount(el.textContent || '');
        };
        const trustedSmzdmUrl = (raw) => {
          const text = (raw || '').trim();
          if (!text) return '';
          let url;
          try {
            url = text.startsWith('/')
              ? new URL(text, 'https://www.smzdm.com')
              : new URL(text, location.href);
          } catch {
            return '';
          }
          const hostname = url.hostname.toLowerCase();
          if (url.protocol !== 'https:' || (hostname !== 'www.smzdm.com' && hostname !== 'post.smzdm.com')) {
            return '';
          }
          return url.toString();
        };
        items.forEach((li) => {
          if (results.length >= limit) return;
          const titleEl = li.querySelector('h5.feed-block-title > a')
                       || li.querySelector('h5 > a');
          if (!titleEl) return;
          const title = (titleEl.getAttribute('title') || titleEl.textContent || '').trim();
          const url = trustedSmzdmUrl(titleEl.getAttribute('href') || titleEl.href || '');
          if (!title || !url) return;
          const priceEl = li.querySelector('.z-highlight');
          const price = priceEl ? priceEl.textContent.trim() : '';
          let mall = '';
          const mallEl = li.querySelector('.z-feed-foot-r .feed-block-extras span')
                      || li.querySelector('.z-feed-foot-r span');
          if (mallEl) mall = mallEl.textContent.trim();
          // Update time lives as the direct text node(s) of .feed-block-extras,
          // alongside the nested mall <span> which we exclude here.
          let updated_at = '';
          const extrasEl = li.querySelector('.z-feed-foot-r .feed-block-extras');
          if (extrasEl) {
            updated_at = Array.from(extrasEl.childNodes)
              .filter((node) => node.nodeType === 3)
              .map((node) => (node.textContent || '').trim())
              .filter(Boolean)
              .join(' ');
          }
          const zhi_count = intFrom(li.querySelector('.price-btn-up .unvoted-wrap span'));
          const buzhi_count = intFrom(li.querySelector('.price-btn-down .unvoted-wrap span'));
          const favorite_count = intFrom(li.querySelector('.feed-btn-fav span'));
          const comments = intFrom(li.querySelector('.feed-btn-comment'));
          results.push({ rank: results.length + 1, title, price, mall, updated_at, zhi_count, buzhi_count, favorite_count, comments, url });
        });
        return results;
      })()
    `;
}

export const smzdmSearchCommand = cli({
    site: 'smzdm',
    name: 'search',
    access: 'read',
    description: '什么值得买搜索好价',
    domain: 'www.smzdm.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'price', 'mall', 'updated_at', 'zhi_count', 'buzhi_count', 'favorite_count', 'comments', 'url'],
    func: async (page, kwargs) => {
        const q = encodeURIComponent(kwargs.query);
        const limit = parseLimit(kwargs.limit);
        // Navigate directly to search results page
        await page.goto(`https://search.smzdm.com/?c=home&s=${q}&v=b`);
        return requireSearchRows(await page.evaluate(buildSmzdmSearchJs(limit)));
    },
});

export const __test__ = { buildSmzdmSearchJs, parseLimit, requireSearchRows, unwrapEvaluateResult };
