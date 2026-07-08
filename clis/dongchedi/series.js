/**
 * dongchedi series — one car series at a glance.
 *
 * Reads the SSR series page `https://www.dongchedi.com/auto/series/<id>`
 * (`pageProps.seriesHomeHead` + `scoreSimpleInfo` + `rankData` +
 * `carModelsData`) into a key/value sheet: brand, official/dealer/used
 * price ranges, 懂车分 score + review count, sales rank, and trim count.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DCD_BASE,
    SERIES_COLUMNS,
    assertPlainObject,
    clean,
    dcdFetchPageProps,
    normalizeSeriesId,
    parseScore,
    requireText,
} from './utils.js';

/** Count on-sale trims (info.car_id present) in the carModelsData tabs. */
function countOnSaleModels(carModelsData) {
    const tabs = carModelsData?.tab_list;
    if (!Array.isArray(tabs)) return null;
    const tab = tabs.find((t) => t?.tab_key === 'online_all') || tabs[0];
    const data = tab?.data;
    if (!Array.isArray(data)) return null;
    return data.filter((d) => (d?.info?.car_id ?? d?.info?.id)).length;
}

/** Format a rank entry "懂车分榜 第1名" from a rankData section. */
function formatRank(section) {
    const top = section?.list?.[0];
    if (!top || !top.rank) return '';
    const name = clean(section.rank_name || top.rank_name);
    return name ? `${name} 第${top.rank}名` : `第${top.rank}名`;
}

/**
 * Pure parser: series pageProps → field/value rows. Exported for unit tests.
 */
export function parseSeries(pp, seriesId) {
    const head = assertPlainObject(pp?.seriesHomeHead, 'dongchedi seriesHomeHead');
    const score = pp.scoreSimpleInfo || {};
    const rank = pp.rankData || {};

    const usedPrice = (head.sh_low_Price || head.sh_high_price)
        ? `${head.sh_low_Price ?? '?'}-${head.sh_high_price ?? '?'}万`
        : '';

    const fields = [
        ['series_id', seriesId],
        ['name', requireText(head.series_name, 'dongchedi series name')],
        ['brand', requireText(head.brand_name, 'dongchedi series brand')],
        ['sub_brand', clean(head.sub_brand_name)],
        ['official_price', head.has_official_price ? clean(head.official_price) : ''],
        ['dealer_price', head.has_dealer_price ? clean(head.dealer_price) : ''],
        ['used_price', usedPrice],
        ['score', parseScore(score.score)],
        ['review_count', Number.isFinite(Number(score.total_review_count)) ? Number(score.total_review_count) : null],
        ['sale_rank', formatRank(rank.sale)],
        ['score_rank', formatRank(rank.score)],
        ['models', countOnSaleModels(pp.carModelsData)],
        ['url', `${DCD_BASE}/auto/series/${seriesId}`],
    ];
    return fields.map(([field, value]) => ({ field, value }));
}

cli({
    site: 'dongchedi',
    name: 'series',
    access: 'read',
    aliases: ['detail'],
    description: '懂车帝车系概览（品牌 / 指导价 / 二手价 / 懂车分 / 销量排名 / 在售款型数）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 search 的 series_id，或 /auto/series/<id> URL）' },
    ],
    columns: SERIES_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const pp = await dcdFetchPageProps(`/auto/series/${seriesId}`, `series ${seriesId}`);
        return parseSeries(pp, seriesId);
    },
});
