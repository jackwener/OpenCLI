// jiuyangongshe latest — most recently published research notes.
//
// Source: GET https://www.jiuyangongshe.com/study_publish
//         The publish page mirrors the hot page shape: `data[0].list[]`
//         holds the article items in reverse-chronological order. The first
//         few entries are pinned via `is_top=1`; the rest fall in by
//         `create_time` descending.
//
// `create_time` is an ISO-ish string ("YYYY-MM-DD HH:mm:ss"). When `--days`
// is supplied we parse that timestamp and skip both pinned items and any
// rows older than the cutoff.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    extractArticleList,
    shapeArticleRow,
} from './_util.js';

const PUBLISH_URL = 'https://www.jiuyangongshe.com/study_publish';

/**
 * Parse a "YYYY-MM-DD HH:mm:ss" string into a UTC ms timestamp. Returns
 * `null` if the value is missing or malformed — callers treat `null` as
 * "skip" so a bad timestamp never silently flips the day filter.
 *
 * @param {unknown} value
 * @returns {number | null}
 */
function parsePublishTime(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const parsed = Date.parse(value.replace(' ', 'T') + 'Z');
    return Number.isNaN(parsed) ? null : parsed;
}

cli({
    site: 'jiuyangongshe',
    name: 'latest',
    access: 'read',
    description: 'Most recently published research notes on 韭研公社 (jiuyangongshe.com)',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (default 20, max 50)' },
        { name: 'days', type: 'int', default: 0, help: 'Only include posts from the last N days (skips pinned items). 0 = no filter.' },
    ],
    columns: [
        'rank', 'id', 'title', 'author', 'publishedAt', 'summary',
        'views', 'comments', 'likes', 'forwards', 'tickers', 'url',
    ],
    func: async (args) => {
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const days = Math.max(0, Math.floor(Number(args.days) || 0));
        const cutoffMs = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

        const html = await fetchPage(PUBLISH_URL);
        const payload = extractNuxtPayload(html);
        const rawList = extractArticleList(payload);
        if (!rawList.length) {
            throw new EmptyResultError(
                'jiuyangongshe latest',
                'No articles found in the SSR data block — site may have changed layout.',
            );
        }

        const rows = [];
        for (let idx = 0; idx < rawList.length && rows.length < limit; idx += 1) {
            const item = rawList[idx];
            if (!item) continue;
            // When filtering by days: skip pinned rows (they may be much
            // older than the rest of the page) and drop rows with a
            // create_time that's outside the cutoff window.
            if (cutoffMs !== null) {
                if (item.is_top) continue;
                const ts = parsePublishTime(item.create_time);
                if (ts !== null && ts < cutoffMs) continue;
            }
            const row = shapeArticleRow(item, rows.length);
            if (row) rows.push(row);
        }

        if (!rows.length) {
            const reason = cutoffMs !== null
                ? `No research notes published within the last ${days} day(s).`
                : 'All articles were filtered out.';
            throw new EmptyResultError('jiuyangongshe latest', reason);
        }
        return rows;
    },
});