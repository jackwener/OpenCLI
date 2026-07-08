// juejin hot: Juejin's article hot ranking, optionally scoped to a category.
//
// Hits the `article_rank` endpoint that backs the "hot" board on the Juejin
// web UI. Returns a different envelope from the recommend feed
// (`content` / `content_counter` / `author`), so the mapping lives in utils.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CATEGORY_ALIASES,
    juejinFetch,
    mapHotItem,
    readDataArray,
    requireBoundedInt,
    resolveCategory,
} from './utils.js';

cli({
    site: 'juejin',
    name: 'hot',
    access: 'read',
    description: 'Juejin (掘金) hot article ranking, optionally scoped to a category',
    domain: 'api.juejin.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'category', type: 'string', required: false, help: `Category slug or numeric id. Slugs: ${Object.keys(CATEGORY_ALIASES).join(', ')}. Defaults to "backend".` },
        { name: 'limit', type: 'int', default: 20, help: 'Max articles (1-50).' },
    ],
    columns: ['rank', 'article_id', 'title', 'brief', 'views', 'likes', 'comments', 'hot_rank', 'author', 'url'],
    func: async (args) => {
        const categoryId = resolveCategory(args.category) || CATEGORY_ALIASES.backend;
        const limit = requireBoundedInt(args.limit, 20, 50);
        const path = `/content_api/v1/content/article_rank?category_id=${encodeURIComponent(categoryId)}&type=hot`;
        const payload = await juejinFetch(path, null, 'juejin hot', 'GET');
        const data = readDataArray(payload, 'juejin hot');
        return data.slice(0, limit).map((row, i) => mapHotItem(row, i + 1));
    },
});
