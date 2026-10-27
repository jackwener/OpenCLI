// jiuyangongshe ticker — articles tagged with a given A-share ticker.
//
// The site's feed pages attach a `stock_list: [{name, code}]` array to each
// post. Codes arrive in two shapes:
//   - Prefixed: `sh600519`, `sz002156` (case-insensitive exchange tag)
//   - Raw:      `01688` (no prefix, e.g. HK-listed mainland names)
//
// `normalizeTickerCode` (in `_util.js`) strips the prefix so we can match
// either shape against a user-supplied ticker.
//
// Strategy:
//   - `--sort hot`  → primary fetch is `/study_hot`; fall back to
//                     `/study_publish` when the hot feed alone is too thin.
//   - `--sort time` → primary fetch is `/study_publish`; fall back to
//                     `/study_hot` likewise. Pinned (`is_top=1`) rows are
//                     skipped under `--sort time` because they are not in
//                     the natural publish order.
//
// Matching preserves the order rows appeared in on the page, and
// de-duplicates by `article_id`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    extractArticleList,
    shapeArticleRow,
    normalizeTickerCode,
} from './_util.js';

const HOT_URL = 'https://www.jiuyangongshe.com/study_hot';
const PUBLISH_URL = 'https://www.jiuyangongshe.com/study_publish';

/** Load a single feed page and return its `data[0].list[]` (may be empty). */
async function loadFeed(url) {
    const html = await fetchPage(url);
    const payload = extractNuxtPayload(html);
    return extractArticleList(payload);
}

/**
 * Does this article item reference the given normalized ticker code?
 * `stock_list` is the only authoritative signal — title-string matching
 * would over-fire on common codes.
 */
function itemMatchesTicker(item, target) {
    if (!target) return false;
    const list = Array.isArray(item?.stock_list) ? item.stock_list : [];
    for (const entry of list) {
        if (!entry || typeof entry.code !== 'string') continue;
        if (normalizeTickerCode(entry.code) === target) return true;
    }
    return false;
}

cli({
    site: 'jiuyangongshe',
    name: 'ticker',
    access: 'read',
    description: 'Research notes tagged with a given A-share ticker on 韭研公社',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'code',
            positional: true,
            required: true,
            help: 'Ticker code, e.g. 600519, sh600519, SZ002156, 01688',
        },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows to return (default 30, max 100)' },
        {
            name: 'sort',
            default: 'hot',
            choices: ['hot', 'time'],
            help: 'Primary sort: hot (热度, default) or time (最新发布)',
        },
    ],
    columns: [
        'rank', 'id', 'title', 'author', 'publishedAt', 'summary',
        'comments', 'likes', 'url',
    ],
    func: async (args) => {
        const target = normalizeTickerCode(String(args.code ?? ''));
        if (!target) {
            throw new ArgumentError(
                'code cannot be empty',
                'Pass a non-empty ticker, e.g.: opencli jiuyangongshe ticker 600519',
            );
        }
        const limit = Math.max(1, Math.min(100, Number(args.limit) || 30));
        const sort = args.sort === 'time' ? 'time' : 'hot';
        const primary = sort === 'time' ? PUBLISH_URL : HOT_URL;
        const fallback = sort === 'time' ? HOT_URL : PUBLISH_URL;

        let primaryList = [];
        let fallbackList = [];
        try {
            primaryList = await loadFeed(primary);
        } catch (err) {
            // Network / parse errors from the primary feed should not be
            // swallowed; surface them.
            throw err;
        }
        if (primaryList.length < limit) {
            try {
                fallbackList = await loadFeed(fallback);
            } catch (err) {
                // The fallback is best-effort. If it fails, keep what we
                // already collected from the primary feed.
                fallbackList = [];
            }
        }

        const seen = new Set();
        const rows = [];
        const matches = (item) => {
            // Pinned rows are skipped under --sort time only: they are not
            // chronological, so surfacing them under time sort is misleading.
            // Under hot sort, pinning is a relevance signal worth keeping.
            if (sort === 'time' && item?.is_top) return false;
            return itemMatchesTicker(item, target);
        };

        const consider = (item) => {
            if (!item || !item.article_id) return;
            if (seen.has(item.article_id)) return;
            if (!matches(item)) return;
            seen.add(item.article_id);
            const row = shapeArticleRow(item, rows.length);
            if (row) rows.push(row);
        };

        for (const item of primaryList) consider(item);
        if (rows.length < limit) {
            for (const item of fallbackList) consider(item);
        }

        if (!rows.length) {
            throw new EmptyResultError(
                'jiuyangongshe ticker',
                `No articles matched ticker "${target}" in the recent feed.`,
            );
        }
        return rows.slice(0, limit);
    },
});