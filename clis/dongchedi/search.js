/**
 * dongchedi search — find car series (车系) by keyword.
 *
 * Hits the SSR search page `https://www.dongchedi.com/search?keyword=...`
 * and reads `pageProps.searchData.data`. That list mixes cards (series,
 * videos, news, dealers); we keep only car-series cards (cell_type 26 with
 * a real series_id) and surface name / brand / official + dealer price.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    DCD_BASE,
    SEARCH_COLUMNS,
    clean,
    requireArray,
    requireStableId,
    requireText,
    dcdFetchPageProps,
    requireLimit,
} from './utils.js';

/** cell_type for a car-series result card. */
const SERIES_CELL_TYPE = 26;

/**
 * Pure parser: searchData → series rows. Exported for unit testing against
 * the frozen fixture so shape drift is caught without a live fetch.
 */
export function parseSearchRows(searchData, limit) {
    const data = requireArray(searchData?.data, 'dongchedi searchData.data');
    const rows = [];
    for (const [index, item] of data.entries()) {
        if (item?.cell_type !== SERIES_CELL_TYPE) continue;
        const seriesId = requireStableId(item?.series_id, `dongchedi search row ${index + 1}`);
        const d = item.display || {};
        const name = requireText(d.series_name || d.title, `dongchedi search row ${index + 1} name`);
        rows.push({
            rank: rows.length + 1,
            series_id: seriesId,
            name,
            brand: clean(d.sub_brand_name),
            official_price: clean(d.official_price),
            dealer_price: clean(d.agent_price),
            pictures: Number.isFinite(Number(d.picture_num)) ? Number(d.picture_num) : null,
            url: `${DCD_BASE}/auto/series/${seriesId}`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'dongchedi',
    name: 'search',
    access: 'read',
    description: '懂车帝车系搜索（按关键词，返回车系 + 指导价/经销商价）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', required: true, positional: true, help: '搜索关键词，例如 "宝马X5" 或 "汉兰达"' },
        { name: 'limit', type: 'int', default: 15, help: '返回的车系数量（最多 30）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const keyword = String(args.keyword || '').trim();
        if (!keyword) throw new ArgumentError('keyword', 'must be a non-empty string');
        const limit = requireLimit(args.limit, 15, 30);

        const pp = await dcdFetchPageProps(
            `/search?keyword=${encodeURIComponent(keyword)}`,
            `search "${keyword}"`,
        );
        const rows = parseSearchRows(pp.searchData, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `dongchedi search "${keyword}"`,
                'No car series matched. Try the model name, e.g. "宝马X5" or "汉兰达".',
            );
        }
        return rows;
    },
});
