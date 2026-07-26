// jiuyangongshe search — full-text search across research notes.
//
// Source: GET https://www.jiuyangongshe.com/search/new?k=<query>
//         The page renders the same Nuxt SSR block used by the feed pages,
//         with `data[0].data.list` holding the result rows.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    shapeArticleRow,
} from './_util.js';

cli({
    site: 'jiuyangongshe',
    name: 'search',
    access: 'read',
    description: 'Search research notes on 韭研公社 (jiuyangongshe.com)',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'query',
            required: true,
            positional: true,
            help: 'Search keyword (topic, stock name, ticker code, author, etc.)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (default 20, max 50)' },
    ],
    columns: [
        'rank', 'id', 'title', 'author', 'publishedAt', 'summary',
        'views', 'comments', 'likes', 'forwards', 'tickers', 'url',
    ],
    func: async (args) => {
        const query = String(args.query ?? '').trim();
        if (!query) {
            throw new ArgumentError('query cannot be empty', 'Pass a non-empty query, e.g.: opencli jiuyangongshe search "贵州茅台"');
        }
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const searchUrl = `https://www.jiuyangongshe.com/search/new?k=${encodeURIComponent(query)}`;
        const html = await fetchPage(searchUrl);
        const payload = extractNuxtPayload(html);
        const entry = Array.isArray(payload?.data) ? payload.data[0] : null;
        const rawList = entry && Array.isArray(entry.list) ? entry.list : [];
        if (!rawList.length) {
            throw new EmptyResultError(
                'jiuyangongshe search',
                `No research notes matched "${query}".`,
            );
        }
        const rows = [];
        for (let idx = 0; idx < rawList.length && rows.length < limit; idx += 1) {
            const row = shapeArticleRow(rawList[idx], rows.length);
            if (row) rows.push(row);
        }
        if (!rows.length) {
            throw new EmptyResultError(
                'jiuyangongshe search',
                `All matching notes for "${query}" were filtered out.`,
            );
        }
        return rows;
    },
});
