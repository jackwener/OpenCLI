/**
 * hongguo rank — the 榜单 pages at hongguoduanju.com/rank/<slug>.
 *
 * Each board is SSR'd 20 rows per page (`?page=N`, 5 pages). The loader key is
 * route-specific (`rank_hot-drama/page`, `rank_new-drama/page`, ...), so the
 * board is located as the loader entry that carries `content.rankList`.
 * `metric` is the board's headline figure as the site prints it
 * (热度 / 热搜 / 收藏 / 期待 ...), which differs per board.
 * Not-yet-released series (`reservationOnly`, the whole subscribe board) have
 * no detail page on the site, so they are flagged `upcoming` with no url.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    HG_DOMAIN,
    RANK_COLUMNS,
    clean,
    findLoaderEntry,
    hgFetchLoaderData,
    joinTags,
    requireLimit,
    requireSeriesId,
    seriesUrl,
    toInt,
} from './utils.js';

export const RANK_TYPES = {
    hot: 'hot-drama',
    new: 'new-drama',
    'hot-search': 'hot-search-drama',
    'must-watch': 'must-watch-drama',
    prestige: 'prestige-drama',
    followed: 'followed-drama',
    subscribe: 'subscribe-drama',
    real: 'hot-real-drama',
    comic: 'hot-comic-drama',
    ai: 'hot-ai-drama',
};

export function findRankBoard(loaderData) {
    return findLoaderEntry(loaderData, (v) => Array.isArray(v.content?.rankList));
}

export function parseRankItem(item) {
    const seriesId = requireSeriesId(item?.seriesId ?? item?.id, 'hongguo rank item');
    const upcoming = item.reservationOnly === true;
    return {
        rank: toInt(item.rank),
        series_id: seriesId,
        title: clean(item.title),
        metric: clean(item.primaryMetricText),
        score: clean(item.scoreText),
        favorites: clean(item.favoriteText),
        likes: clean(item.likeText),
        episodes: toInt(item.episodeCount),
        tags: joinTags(item.tags),
        upcoming,
        url: upcoming ? '' : seriesUrl(seriesId),
    };
}

cli({
    site: 'hongguo',
    name: 'rank',
    access: 'read',
    description: '红果短剧榜单（热播 / 新剧 / 热搜 / 必看 / 口碑 / 追剧 / 预约 / 真人 / 漫剧 / AI 剧）',
    domain: HG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'type',
            default: 'hot',
            choices: Object.keys(RANK_TYPES),
            help: `Board: ${Object.keys(RANK_TYPES).join(', ')}`,
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of rows (1-100)' },
    ],
    columns: RANK_COLUMNS,
    func: async (args) => {
        const type = String(args.type ?? 'hot').trim();
        const slug = RANK_TYPES[type];
        if (!slug) throw new ArgumentError(`type must be one of: ${Object.keys(RANK_TYPES).join(', ')}`);
        const limit = requireLimit(args.limit, 20, 100);
        const rows = [];
        let totalPages = 1;
        for (let page = 1; page <= totalPages && rows.length < limit; page++) {
            const path = page === 1 ? `/rank/${slug}` : `/rank/${slug}?page=${page}`;
            const board = findRankBoard(await hgFetchLoaderData(path, `rank ${type} page ${page}`));
            if (!board) throw new CommandExecutionError(`hongguo rank ${type} page ${page} carried no rankList`);
            totalPages = toInt(board.content.pagination?.totalPages) ?? 1;
            for (const item of board.content.rankList) {
                rows.push(parseRankItem(item));
                if (rows.length >= limit) break;
            }
        }
        if (!rows.length) throw new EmptyResultError(`hongguo rank ${type}`, 'The board is empty.');
        return rows;
    },
});
