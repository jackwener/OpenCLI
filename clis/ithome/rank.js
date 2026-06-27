/**
 * ithome rank — IT之家 热榜 ranking boards.
 *
 * Hits the public JSON API `api.ithome.com/json/newslist/rank`, which returns
 * four boards: 48小时热榜 / 周热门 / 周评论榜 / 月榜. Each entry carries the
 * read count (`hitcount`) and comment count, so it's a popularity-ranked
 * complement to `news`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    IH_API,
    RANK_COLUMNS,
    RANK_BOARDS,
    clean,
    requireLimit,
    articleUrl,
    ihFetchJson,
} from './utils.js';

/**
 * Pure parser: rank JSON → ranked rows tagged by board. Exported for unit
 * testing. When `board` is given, only boards whose label or key contains it
 * are kept; `rank` is the position within each board.
 */
export function parseRankRows(json, { board, limit }) {
    const rows = [];
    for (const [key, label] of Object.entries(RANK_BOARDS)) {
        if (board && !label.includes(board) && !key.includes(board.toLowerCase())) continue;
        const list = Array.isArray(json?.[key]) ? json[key] : [];
        let n = 0;
        for (const it of list) {
            const newsid = it?.newsid != null ? String(it.newsid) : '';
            const title = clean(it?.title);
            if (!newsid || !title) continue;
            n += 1;
            rows.push({
                board: label,
                rank: n,
                newsid,
                title,
                hits: Number.isFinite(Number(it?.hitcount)) ? Number(it.hitcount) : 0,
                comments: Number.isFinite(Number(it?.commentcount)) ? Number(it.commentcount) : 0,
                url: articleUrl(it?.url),
            });
            if (rows.length >= limit) return rows;
        }
    }
    return rows;
}

cli({
    site: 'ithome',
    name: 'rank',
    access: 'read',
    aliases: ['hot'],
    description: 'IT之家热榜（48小时/周热门/周评论/月榜，返回标题 + 阅读数 + 评论数 + 文章 URL）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'board', positional: true, help: '只看某个榜单：48 / 周热门 / 评论 / 月（缺省返回全部 4 个榜）' },
        { name: 'limit', type: 'int', default: 20, help: '返回的条目总数（最多 80）' },
    ],
    columns: RANK_COLUMNS,
    func: async (args) => {
        const board = clean(args.board) || null;
        const limit = requireLimit(args.limit, 20, 80);
        const json = await ihFetchJson(`${IH_API}/json/newslist/rank`, 'rank');
        const rows = parseRankRows(json, { board, limit });
        if (rows.length === 0) {
            throw new EmptyResultError(
                board ? `ithome rank ${board}` : 'ithome rank',
                board
                    ? '该榜单没匹配到 — 试试 48 / 周热门 / 评论 / 月。'
                    : 'No ranking rows returned — the rank API may have changed.',
            );
        }
        return rows;
    },
});
