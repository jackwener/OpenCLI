// Hupu hot/home threads — public SSR HTML scrape via in-page DOM walk.
//
// Replaces the legacy `pipeline:[]` + `documentElement.outerHTML` regex,
// which had two anti-pattern problems:
//   1. Regex against `outerHTML` is brittle to whitespace / attribute order
//      shifts and silently drops rows when the markup wobbles.
//   2. The regex captured every 9-digit thread anchor on the page, not just
//      the rows inside `.t-info` containers — `.list-item` rows and pure
//      navigation links got conflated.
//
// New behavior:
//   - `func` form with `Strategy.PUBLIC` + `browser:true` (consistent with
//     other public hupu adapters).
//   - Upfront `--limit` validation: must be a positive integer ≤ 100, no
//     silent clamp; `ArgumentError` on bad input.
//   - DOM walk via `querySelectorAll('.t-info')` — same scope hupu's web
//     client renders, so the row count matches what the human sees.
//   - Enriched columns: `lights` (亮 count, int|null), `replies` (回复
//     count, int|null), `forum` (sub-section name from sibling `.t-label`),
//     `is_hot` (whether the page tagged the row with `class=" hot"` —
//     transparent surfacing of hupu's own hot marker without filtering, so
//     existing callers see the same row order).
//   - Empty page → `EmptyResultError`, never silent `[]`.
//   - Pure extraction (`extractHupuHotRowsFromDoc`) is a Node-side export
//     so JSDOM-against-frozen-fixture tests can call it directly while the
//     live IIFE embeds the same function via `${fn.toString()}` (mirrors
//     dianping #1313 pattern).

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const HUPU_HOST = 'https://bbs.hupu.com';
export const HOT_LIMIT_DEFAULT = 20;
export const HOT_LIMIT_MAX = 100;

export function normalizeHotLimit(raw) {
    if (raw === undefined || raw === null || raw === '') {
        return HOT_LIMIT_DEFAULT;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > HOT_LIMIT_MAX) {
        throw new ArgumentError(
            `--limit must be a positive integer in [1, ${HOT_LIMIT_MAX}], got ${JSON.stringify(raw)}`,
        );
    }
    return n;
}

// Parse hupu count strings like "50亮", "359回复", "1.2万" → typed int.
// Returns null when the input does not look like a count we can read.
// `0` is preserved (real value), `null` means "we could not extract it"
// — never use `0` as an unknown sentinel here.
export function parseHupuCount(raw) {
    if (raw === undefined || raw === null) return null;
    const text = String(raw).trim();
    if (!text) return null;
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(万)?/);
    if (!match) return null;
    const num = parseFloat(match[1]);
    if (!Number.isFinite(num)) return null;
    return Math.round(match[2] === '万' ? num * 10000 : num);
}

// Pure extractor: walks `.t-info` containers and returns at most `limit`
// rows. `doc` is a Document (live `document` in browser, JSDOM document
// in tests). `parseCount` is injected so the same function works in both
// contexts (in-browser eval embeds it via `${fn.toString()}`, JSDOM tests
// pass the imported reference).
export function extractHupuHotRowsFromDoc(doc, limit, parseCount) {
    const out = [];
    const items = doc.querySelectorAll('.t-info');
    for (let i = 0; i < items.length && out.length < limit; i += 1) {
        const info = items[i];
        const anchor = info.querySelector('a[href]');
        if (!anchor) continue;
        const href = anchor.getAttribute('href') || '';
        const tidMatch = href.match(/^\/(\d{9})\.html$/);
        if (!tidMatch) continue;
        const tid = tidMatch[1];
        const titleEl = anchor.querySelector('.t-title');
        const title = titleEl ? (titleEl.textContent || '').trim() : '';
        if (!title) continue;
        const classes = (anchor.getAttribute('class') || '').split(/\s+/).filter(Boolean);
        const isHot = classes.includes('hot');
        const lightsEl = info.querySelector('.t-lights');
        const repliesEl = info.querySelector('.t-replies');
        const lights = parseCount(lightsEl ? lightsEl.textContent : null);
        const replies = parseCount(repliesEl ? repliesEl.textContent : null);
        // forum label sits beside `.t-info` inside `.list-item`
        const listItem = info.parentElement;
        const labelEl = listItem ? listItem.querySelector('.t-label a') : null;
        const forum = labelEl ? (labelEl.textContent || '').trim() : '';
        out.push({
            rank: out.length + 1,
            tid,
            title,
            lights,
            replies,
            forum,
            is_hot: isHot,
            url: `${HUPU_HOST}/${tid}.html`,
        });
    }
    return out;
}

export function buildHotScript(limit) {
    return `
(async () => {
  const HUPU_HOST = ${JSON.stringify(HUPU_HOST)};
  ${parseHupuCount.toString()}
  ${extractHupuHotRowsFromDoc.toString()}
  // Wait briefly for .t-info rows to render in case the page is still
  // hydrating; bbs.hupu.com is mostly SSR so this returns fast.
  const start = Date.now();
  while (document.querySelectorAll('.t-info').length === 0 && Date.now() - start < 5000) {
    await new Promise(r => setTimeout(r, 100));
  }
  return extractHupuHotRowsFromDoc(document, ${JSON.stringify(limit)}, parseHupuCount);
})()
`;
}

async function getHupuHot(page, args) {
    const limit = normalizeHotLimit(args.limit);
    await page.goto(`${HUPU_HOST}/`, { waitUntil: 'load', settleMs: 1000 });
    let rows;
    try {
        rows = await page.evaluate(buildHotScript(limit));
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new CommandExecutionError(
            `Failed to read hupu hot threads: ${message}`,
            'bbs.hupu.com may be unreachable or its markup may have changed',
        );
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError(
            'hupu/hot',
            'No threads found on bbs.hupu.com — page structure may have changed',
        );
    }
    return rows;
}

export const hotCommand = cli({
    site: 'hupu',
    name: 'hot',
    access: 'read',
    description: '虎扑首页热门帖子（含 lights / replies / forum / is_hot 列）',
    domain: 'bbs.hupu.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: HOT_LIMIT_DEFAULT, help: `Number of threads (1-${HOT_LIMIT_MAX})` },
    ],
    columns: ['rank', 'tid', 'title', 'lights', 'replies', 'forum', 'is_hot', 'url'],
    func: getHupuHot,
});

export const __test__ = {
    buildHotScript,
};
