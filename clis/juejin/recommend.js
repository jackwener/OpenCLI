// juejin recommend: Juejin homepage recommendation feed.
//
// Hits the `recommend_all_feed` endpoint, which mirrors what the Juejin web UI
// renders on the front page; `sort_type` 200 is the default "recommended" mix.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    juejinFetch,
    mapFeedItem,
    readDataArray,
    requireBoundedInt,
    requireCursor,
} from './utils.js';

function readResponseCursor(value) {
    if (value == null || value === '') return '';
    try {
        return requireCursor(value);
    }
    catch {
        throw new CommandExecutionError('juejin recommend returned a malformed cursor');
    }
}

cli({
    site: 'juejin',
    name: 'recommend',
    access: 'read',
    description: 'Juejin (掘金) homepage recommended article feed',
    domain: 'api.juejin.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max articles (1-100, single page).' },
        { name: 'cursor', type: 'string', default: '0', help: 'Pagination cursor; pass back the previous response\'s next-page cursor to keep scrolling.' },
    ],
    columns: ['rank', 'article_id', 'title', 'brief', 'views', 'likes', 'comments', 'author', 'tags', 'url', 'next_cursor', 'has_more'],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 100);
        const cursor = requireCursor(args.cursor);
        const payload = await juejinFetch(
            '/recommend_api/v1/article/recommend_all_feed',
            { id_type: 2, client_type: 2608, sort_type: 200, limit, cursor },
            'juejin recommend',
        );
        const data = readDataArray(payload, 'juejin recommend');
        const nextCursor = readResponseCursor(payload.cursor);
        if (payload.has_more != null && typeof payload.has_more !== 'boolean') {
            throw new CommandExecutionError('juejin recommend returned a malformed has_more flag');
        }
        const hasMore = payload.has_more == null ? '' : String(payload.has_more);
        if (payload.has_more === true && !nextCursor) {
            throw new CommandExecutionError('juejin recommend returned has_more without a next cursor');
        }
        return data.slice(0, limit).map((row, i) => ({
            ...mapFeedItem(row, i + 1),
            next_cursor: nextCursor,
            has_more: hasMore,
        }));
    },
});
