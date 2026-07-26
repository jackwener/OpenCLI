// jiuyangongshe hot — list trending research notes sorted by recent heat.
//
// Source: GET https://www.jiuyangongshe.com/study_hot
//         The page is rendered by the site's Nuxt SSR pipeline; the SSR data
//         graph embedded in the HTML carries the article list we need.
//
// Other sort modes: publish (/study_publish), action (/study_action),
// 30-day (/study_30). The `order` flag controls the sort.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    extractArticleList,
    extractRankList,
    shapeArticleRow,
} from './_util.js';

/** Resolve a sort key onto the matching URL path on the site. */
const SORT_TO_PATH = {
    hot: '/study_hot',
    publish: '/study_publish',
    action: '/study_action',
    '30': '/study_30',
};

cli({
    site: 'jiuyangongshe',
    name: 'hot',
    access: 'read',
    description: 'Trending research notes on 韭研公社 (jiuyangongshe.com)',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'sort',
            default: 'hot',
            help: 'Sort mode: hot (热度), publish (最新发布), action (最新互动), 30 (30天热度)',
            choices: Object.keys(SORT_TO_PATH),
        },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (default 20, max 50)' },
    ],
    columns: [
        'rank', 'id', 'title', 'author', 'publishedAt', 'summary',
        'views', 'comments', 'likes', 'forwards', 'tickers', 'url',
    ],
    func: async (args) => {
        const sort = SORT_TO_PATH[args.sort] ? args.sort : 'hot';
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const url = `https://www.jiuyangongshe.com${SORT_TO_PATH[sort]}`;
        const html = await fetchPage(url);
        const payload = extractNuxtPayload(html);
        const rawList = extractArticleList(payload);
        if (!rawList.length) {
            throw new EmptyResultError(
                'jiuyangongshe hot',
                'No articles found in the SSR data block — site may have changed layout.',
            );
        }
        const rows = [];
        for (let idx = 0; idx < rawList.length && rows.length < limit; idx += 1) {
            const row = shapeArticleRow(rawList[idx], rows.length);
            if (row) rows.push(row);
        }
        if (!rows.length) {
            throw new EmptyResultError('jiuyangongshe hot', 'All articles were filtered out.');
        }
        return rows;
    },
});
