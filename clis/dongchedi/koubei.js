/**
 * dongchedi koubei — owner reviews (口碑) for a car series.
 *
 * Reads `pageProps.reviewListData.review_list` from the SSR score page
 * `https://www.dongchedi.com/auto/series/score/<id>-x-x-x-x-x`. Each entry
 * is a real owner write-up: rating, the trim/year they bought, likes,
 * comment count, and the full review body (snippetted for the table; the
 * `url` column links to the complete article).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    DCD_BASE,
    KOUBEI_COLUMNS,
    clean,
    dcdFetchPageProps,
    normalizeSeriesId,
    parseScore,
    requireArray,
    requireStableId,
    requireText,
    requireLimit,
    snippet,
} from './utils.js';

/**
 * Pure parser: reviewListData → review rows. Exported for unit testing.
 */
export function parseKoubei(reviewListData, limit) {
    const list = reviewListData?.review_list;
    requireArray(list, 'dongchedi reviewListData.review_list');
    const rows = [];
    for (const [index, it] of list.entries()) {
        const buy = it?.buy_car_info || {};
        const carName = clean(buy.car_name || it?.car_name);
        const year = buy.year || it?.year;
        const car = [year ? String(year) : '', carName].filter(Boolean).join(' ');
        const gid = requireStableId(it?.gid_str || it?.gid, `dongchedi koubei row ${index + 1}`);
        rows.push({
            rank: rows.length + 1,
            user: requireText(it?.user_info?.name, `dongchedi koubei row ${index + 1} user`),
            car,
            score: parseScore(it?.score_info?.score),
            likes: Number.isFinite(Number(it?.digg_count_en)) ? Number(it.digg_count_en) : 0,
            comments: Number.isFinite(Number(it?.comment_count_en)) ? Number(it.comment_count_en) : 0,
            content: snippet(requireText(it?.content, `dongchedi koubei row ${index + 1} content`), 180),
            url: `${DCD_BASE}/ugc/article/${gid}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'dongchedi',
    name: 'koubei',
    access: 'read',
    aliases: ['reviews'],
    description: '懂车帝车系口碑/车主评价（评分 / 购车款型 / 点赞 / 评论 / 正文摘要）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 search 的 series_id，或 /auto/series/<id> URL）' },
        { name: 'limit', type: 'int', default: 10, help: '返回的口碑条数（最多 15，单页 SSR 上限）' },
    ],
    columns: KOUBEI_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const limit = requireLimit(args.limit, 10, 15);
        // The score page carries the SSR-rendered owner-review list.
        const pp = await dcdFetchPageProps(
            `/auto/series/score/${seriesId}-x-x-x-x-x`,
            `koubei ${seriesId}`,
        );
        const rows = parseKoubei(pp.reviewListData, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `dongchedi koubei ${seriesId}`,
                'This series has no owner reviews yet.',
            );
        }
        return rows;
    },
});
