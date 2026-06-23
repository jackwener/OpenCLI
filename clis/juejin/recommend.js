// juejin recommend: Juejin homepage recommendation feed.
//
// Hits the `recommend_all_feed` endpoint, which mirrors what the Juejin web UI
// renders on the front page; `sort_type` 200 is the default "recommended" mix.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    juejinFetch,
    mapFeedItem,
    readDataArray,
    requireBoundedInt,
    requireCursor,
} from './utils.js';

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
    columns: ['rank', 'article_id', 'title', 'brief', 'views', 'likes', 'comments', 'author', 'tags', 'url'],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 100);
        const cursor = requireCursor(args.cursor);
        const payload = await juejinFetch(
            '/recommend_api/v1/article/recommend_all_feed',
            { id_type: 2, client_type: 2608, sort_type: 200, limit, cursor },
            'juejin recommend',
        );
        const data = readDataArray(payload, 'juejin recommend');
        return data.slice(0, limit).map((row, i) => mapFeedItem(row, i + 1));
    },
});
