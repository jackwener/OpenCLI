// jiuyangongshe detail — fetch a single research note by article_id.
//
// Source: GET https://www.jiuyangongshe.com/a/{article_id}
//         Detail pages use the same Nuxt SSR wrapper; the article body lives
//         at `data[0].data`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    shapeDetailRow,
} from './_util.js';

cli({
    site: 'jiuyangongshe',
    name: 'detail',
    access: 'read',
    description: 'Fetch a single research note by article_id on 韭研公社',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'id',
            required: true,
            positional: true,
            help: 'Article ID (the trailing segment of the jiuyangongshe post URL)',
        },
    ],
    columns: [
        'id', 'title', 'author', 'publishedAt', 'updatedAt',
        'views', 'comments', 'likes', 'forwards', 'tickers', 'url', 'summary',
    ],
    func: async (args) => {
        const rawId = String(args.id ?? '').trim();
        // Article IDs are either short alphanumeric (e.g. "4ejtumnjrmy")
        // or longer prefixed forms. We don't restrict to a numeric pattern —
        // we just trim it and verify the page returns a populated article.
        if (!rawId) {
            throw new ArgumentError('id cannot be empty', 'Pass a non-empty article id, e.g.: opencli jiuyangongshe detail 4ejtumnjrmy');
        }
        const url = `https://www.jiuyangongshe.com/a/${encodeURIComponent(rawId)}`;
        const html = await fetchPage(url);
        const payload = extractNuxtPayload(html);
        const entry = Array.isArray(payload?.data) ? payload.data[0] : null;
        const inner = entry && entry.data && typeof entry.data === 'object' ? entry.data : null;
        if (!inner || !inner.article_id) {
            throw new EmptyResultError(
                'jiuyangongshe detail',
                `Article "${rawId}" did not return an article payload — the post may be private, deleted, or the id is incorrect.`,
            );
        }
        const row = shapeDetailRow(inner);
        if (!row) {
            throw new EmptyResultError(
                'jiuyangongshe detail',
                `Article "${rawId}" could not be shaped into a row.`,
            );
        }
        return [row];
    },
});
