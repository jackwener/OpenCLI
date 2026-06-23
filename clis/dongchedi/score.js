/**
 * dongchedi score — 懂车分 rating breakdown for a car series.
 *
 * Reads `pageProps.scoreSimpleInfo` (the series' 8-axis owner rating) and
 * `pageProps.reviewData.same_level_review` (the same-class average) from the
 * SSR series page, so each axis can be shown next to its segment benchmark.
 * Scores are rescaled from x100 ints to /5 floats (422 -> 4.22).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    SCORE_COLUMNS,
    dcdFetchPageProps,
    normalizeSeriesId,
    parseScore,
    requireArray,
} from './utils.js';

/** Dongchedi's 8 rating axes, in display order: [field, 中文 label]. */
const AXES = [
    ['score', '综合'],
    ['space_score', '空间'],
    ['power_score', '动力'],
    ['control_score', '操控'],
    ['comfort_score', '舒适性'],
    ['appearance_score', '外观'],
    ['interiors_score', '内饰'],
    ['configuration_score', '配置'],
];

/**
 * Pure parser: scoreSimpleInfo + same-level average → rows. Exported for tests.
 */
export function parseScoreBreakdown(scoreSimpleInfo, sameLevelAvg) {
    if (!scoreSimpleInfo || typeof scoreSimpleInfo !== 'object' || Array.isArray(scoreSimpleInfo)) {
        throw new EmptyResultError(
            'dongchedi score',
            'This series has no 懂车分 rating yet (too few owner reviews).',
        );
    }
    const ssi = scoreSimpleInfo || {};
    const avg = sameLevelAvg || {};
    return AXES.map(([key, label]) => ({
        dimension: label,
        score: parseScore(ssi[key]),
        same_level_avg: parseScore(avg[key]),
    }));
}

/** Pick the "同级车均值" row out of reviewData.same_level_review. */
function sameLevelAverage(reviewData) {
    const list = reviewData?.same_level_review;
    if (list == null) return reviewData?.average_series_review || {};
    requireArray(list, 'dongchedi same_level_review');
    return list.find((r) => String(r?.series_id) === '0') || list[0] || {};
}

cli({
    site: 'dongchedi',
    name: 'score',
    access: 'read',
    aliases: ['rating'],
    description: '懂车帝车系评分（懂车分 8 维度 + 同级车均值对比）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 search 的 series_id，或 /auto/series/<id> URL）' },
    ],
    columns: SCORE_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const pp = await dcdFetchPageProps(`/auto/series/${seriesId}`, `score ${seriesId}`);
        const rows = parseScoreBreakdown(pp.scoreSimpleInfo, sameLevelAverage(pp.reviewData));
        if (rows.every((r) => r.score == null)) {
            throw new EmptyResultError(
                `dongchedi score ${seriesId}`,
                'This series has no 懂车分 rating yet (too few owner reviews).',
            );
        }
        return rows;
    },
});
