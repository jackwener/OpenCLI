/**
 * hongguo search — `GET /api/search/result?query=&page=` (10 results per page).
 *
 * Only series hits (entries carrying `video_data`, doc_type 23) are returned.
 * The site falls back to loosely related titles when nothing matches, so a
 * nonsense query still yields rows — that is the site's behaviour, not a bug.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    HG_DOMAIN,
    SEARCH_COLUMNS,
    clean,
    hgFetchJson,
    joinTags,
    requireLimit,
    requireSeriesId,
    seriesUrl,
    toInt,
} from './utils.js';

const MAX_PAGES = 5;

export function parseSearchHit(hit) {
    const v = hit.video_data;
    const seriesId = requireSeriesId(v.series_id, 'hongguo search hit');
    return {
        series_id: seriesId,
        title: clean(v.series_title || hit.name),
        episodes: toInt(v.episode_cnt),
        heat: clean(v.hot_score_data?.text),
        favorites: clean(v.favorite_text),
        likes: clean(v.like_text),
        tags: joinTags(v.category_list),
        intro: clean(v.series_intro),
        url: seriesUrl(seriesId),
    };
}

cli({
    site: 'hongguo',
    name: 'search',
    access: 'read',
    description: '搜索红果短剧（剧名 / 演员 / 题材）',
    domain: HG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-50)' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const query = clean(args.query);
        if (!query) throw new ArgumentError('query must be a non-empty string');
        const limit = requireLimit(args.limit, 10, 50);
        const rows = [];
        for (let page = 1; page <= MAX_PAGES && rows.length < limit; page++) {
            const params = page === 1 ? { query } : { query, page };
            const { body } = await hgFetchJson('/api/search/result', { params, label: 'search' });
            if (!Array.isArray(body.searchList)) {
                throw new CommandExecutionError('hongguo search returned no searchList', 'The search API changed shape.');
            }
            for (const hit of body.searchList) {
                if (!hit?.video_data) continue;
                rows.push(parseSearchHit(hit));
                if (rows.length >= limit) break;
            }
            if (!body.hasMore || body.searchList.length === 0) break;
        }
        if (!rows.length) throw new EmptyResultError(`hongguo search "${query}"`, 'No series matched.');
        return rows.map((row, idx) => ({ rank: idx + 1, ...row }));
    },
});
