// jiuyangongshe rank — sidebar community leaderboards.
//
// Source: GET https://www.jiuyangongshe.com/
//         The home page exposes three leaderboards in its SSR state:
//           state.rankList.hot_search_list   — top trending keywords
//           state.rankList.hot_article_list  — top trending posts (titles only)
//           state.rankList.hot_user_list     — top contributors (nickname + integral)
//
// Switch the `kind` flag to pick which leaderboard to dump.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    extractCategoryList,
    extractRankList,
} from './_util.js';



function rankRows(kind, rankList) {
    if (!rankList || typeof rankList !== 'object') return [];
    if (kind === 'search') {
        const list = Array.isArray(rankList.hot_search_list) ? rankList.hot_search_list : [];
        return list.map((item, i) => ({
            rank: i + 1,
            type: 'keyword',
            name: typeof item?.keyword === 'string' ? item.keyword : '',
            detail: '',
            score: null,
            url: item?.keyword
                ? `https://www.jiuyangongshe.com/search/new?k=${encodeURIComponent(item.keyword)}`
                : null,
        }));
    }
    if (kind === 'article') {
        const list = Array.isArray(rankList.hot_article_list) ? rankList.hot_article_list : [];
        return list.map((item, i) => ({
            rank: i + 1,
            type: 'article',
            name: typeof item?.title === 'string' ? item.title : '',
            detail: '',
            score: null,
            url: item?.article_id ? `https://www.jiuyangongshe.com/a/${item.article_id}` : null,
        }));
    }
    if (kind === 'user') {
        const list = Array.isArray(rankList.hot_user_list) ? rankList.hot_user_list : [];
        return list.map((item, i) => ({
            rank: i + 1,
            type: 'user',
            name: typeof item?.nickname === 'string' ? item.nickname : '',
            detail: '',
            score: typeof item?.sum_integral === 'number' ? item.sum_integral : null,
            url: item?.user_id ? `https://www.jiuyangongshe.com/u/${item.user_id}` : null,
        }));
    }
    return [];
}

cli({
    site: 'jiuyangongshe',
    name: 'rank',
    access: 'read',
    description: 'Community leaderboards (hot keywords, hot articles, top users, categories) on 韭研公社',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'kind',
            default: 'search',
            help: 'Which leaderboard to dump: search (关键词), article (帖子), user (用户), category (分类)',
            choices: ['search', 'article', 'user', 'category'],
        },
        { name: 'limit', type: 'int', default: 10, help: 'Max rows to return (default 10, max 20)' },
    ],
    columns: ['rank', 'type', 'name', 'detail', 'score', 'url'],
    func: async (args) => {
        const kind = String(args.kind || 'search');
        const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
        const url = 'https://www.jiuyangongshe.com/';
        const html = await fetchPage(url);
        const payload = extractNuxtPayload(html);

        let rows;
        if (kind === 'category') {
            const cats = extractCategoryList(payload);
            rows = cats.map((c, i) => ({
                rank: i + 1,
                type: 'category',
                name: typeof c?.name === 'string' ? c.name : '',
                detail: '',
                score: null,
                url: null,
            }));
        } else {
            const rankList = extractRankList(payload);
            rows = rankRows(kind, rankList);
        }
        if (!rows.length) {
            throw new EmptyResultError(
                'jiuyangongshe rank',
                `Leaderboard "${kind}" returned no rows — the SSR state shape may have changed.`,
            );
        }
        return rows.slice(0, limit);
    },
});
