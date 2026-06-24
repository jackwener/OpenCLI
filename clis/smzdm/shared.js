/**
 * Shared helpers for 什么值得买 (smzdm) adapters.
 *
 * The feed extractor (`buildSmzdmFeedJs`) is reused by every list-style command
 * — search, the curated home feed (`hot`/`jingxuan`), etc. — because smzdm
 * renders all of them with the same `li.feed-row-wide` markup. Each adapter
 * only swaps the URL it navigates to.
 */
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

/**
 * Browser Bridge sometimes wraps `page.evaluate` results in a
 * `{ session, data }` envelope. Unwrap it so callers always see the raw value.
 */
export function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

/** Fail closed when an extraction payload is not the array of rows we expect. */
export function requireRows(payload) {
    const rows = unwrapEvaluateResult(payload);
    if (!Array.isArray(rows)) {
        throw new CommandExecutionError('Unexpected SMZDM extraction payload shape; expected an array of rows.');
    }
    return rows;
}

/** Validate a `--limit` argument up front, before any browser navigation. */
export function parseLimit(raw, { min = 1, max = 100, fallback = 20 } = {}) {
    let parsed;
    if (raw == null) {
        parsed = fallback;
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
        throw new ArgumentError(`--limit must be an integer between ${min} and ${max}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < min || parsed > max) {
        throw new ArgumentError(`--limit must be between ${min} and ${max}, got ${parsed}`);
    }
    return parsed;
}

/**
 * Build the in-page extraction script for a `li.feed-row-wide` list. Every row
 * carries the full declared column set; interaction metrics default to 0 and
 * the update time to '' when a list item omits them, so no column is ever
 * silently dropped. Untrusted (non-smzdm / non-https) URLs are filtered out.
 */
export function buildSmzdmFeedJs(limit) {
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
          const extrasForMall = li.querySelector('.z-feed-foot-r .feed-block-extras');
          if (extrasForMall) {
            // The mall renders as a nested <a> (links to /mall/...) on the home
            // feed or a nested <span> on search results — never the wrapper
            // itself, which also holds the update-time text node.
            const mallEl = extrasForMall.querySelector('a, span');
            if (mallEl) mall = mallEl.textContent.trim();
          }
          if (!mall) {
            const fallbackMall = li.querySelector('.z-feed-foot-r span:not(.feed-block-extras)');
            if (fallbackMall) mall = fallbackMall.textContent.trim();
          }
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

/** Columns produced by `buildSmzdmFeedJs`, shared by every feed-style command. */
export const FEED_COLUMNS = ['rank', 'title', 'price', 'mall', 'updated_at', 'zhi_count', 'buzhi_count', 'favorite_count', 'comments', 'url'];

/**
 * Resolve a deal id or full smzdm URL into a canonical detail URL.
 * Accepts `174854494`, `/p/174854494/`, or any `https://www.smzdm.com/p/.../`
 * (or `post.smzdm.com`) URL. Rejects anything off-domain.
 */
export function resolveDealUrl(raw) {
    const text = (raw == null ? '' : String(raw)).trim();
    if (!text) {
        throw new ArgumentError('A deal id or smzdm URL is required.');
    }
    // Bare numeric id → /p/<id>/
    if (/^\d+$/.test(text)) {
        return `https://www.smzdm.com/p/${text}/`;
    }
    let url;
    try {
        url = text.startsWith('/')
            ? new URL(text, 'https://www.smzdm.com')
            : new URL(text);
    }
    catch {
        throw new ArgumentError(`Not a valid deal id or smzdm URL: ${JSON.stringify(raw)}`);
    }
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (hostname !== 'www.smzdm.com' && hostname !== 'post.smzdm.com')) {
        throw new ArgumentError(`Refusing off-domain or non-https URL: ${JSON.stringify(raw)}`);
    }
    return url.toString();
}
