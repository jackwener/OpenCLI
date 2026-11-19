/**
 * hongguo detail — one series from the SSR page /detail?series_id=<id>
 * (`detail_page.seriesDetail` + `seriesSocialInfo`) as field/value rows.
 * An unknown id is answered with HTTP 404 → EmptyResultError.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    DETAIL_COLUMNS,
    HG_DOMAIN,
    clean,
    formatChinaTime,
    hgFetchLoaderData,
    joinTags,
    normalizeSeriesId,
    requireSeriesId,
    seriesUrl,
    toInt,
} from './utils.js';

function formatCast(celebrities) {
    if (!Array.isArray(celebrities)) return '';
    return celebrities
        .map((c) => {
            const name = clean(c?.nickname);
            const role = clean(c?.sub_title);
            return name && role ? `${name} (${role})` : name;
        })
        .filter(Boolean)
        .join(', ');
}

export function parseDetail(loaderData) {
    const page = loaderData?.detail_page;
    const sd = page?.seriesDetail;
    if (!sd || typeof sd !== 'object') {
        throw new CommandExecutionError('hongguo detail page carried no seriesDetail', 'Hongguo likely changed its page structure.');
    }
    const social = page.seriesSocialInfo || {};
    const seriesId = requireSeriesId(sd.series_id, 'hongguo detail');
    const fields = [
        ['series_id', seriesId],
        ['title', clean(sd.series_name)],
        ['episodes', toInt(sd.episode_cnt)],
        ['total_episodes', toInt(sd.series_episode_info?.episode_total_cnt)],
        ['web_episodes', toInt(sd.accessible_episode_cnt)],
        ['tags', joinTags(sd.tags)],
        ['cast', formatCast(sd.celebrities)],
        ['rating', social.rating ?? null],
        ['rating_count', toInt(social.rating_count)],
        ['heat', clean(social.hot_score_data?.text)],
        ['likes', toInt(social.series_like_count)],
        ['favorites', toInt(social.series_favorite_count)],
        ['reviews', toInt(social.reviews?.total_count)],
        ['rank_label', clean(social.rank_label)],
        ['released', formatChinaTime(sd.first_visible_time)],
        ['record_number', clean(sd.record_number)],
        ['intro', clean(sd.series_intro)],
        ['cover', clean(sd.series_cover)],
        ['url', seriesUrl(seriesId)],
    ];
    return fields.map(([field, value]) => ({ field, value }));
}

cli({
    site: 'hongguo',
    name: 'detail',
    access: 'read',
    description: '红果短剧详情（集数 / 演员 / 评分 / 热度 / 点赞收藏 / 简介）',
    domain: HG_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', positional: true, required: true, help: 'Series id (from feed/rank/search), or a /detail?series_id= URL' },
    ],
    columns: DETAIL_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const loaderData = await hgFetchLoaderData(`/detail?series_id=${seriesId}`, `detail ${seriesId}`);
        return parseDetail(loaderData);
    },
});
