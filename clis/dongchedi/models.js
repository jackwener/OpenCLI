/**
 * dongchedi models — the trims (款型) of a car series with prices.
 *
 * Reads `pageProps.carModelsData.tab_list` from the SSR series page. Each
 * tab ("在售" / a model-year / "停售") holds trim rows; rows carry a real
 * `info.car_id`. Year-group header rows (no car_id) are skipped.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    MODELS_COLUMNS,
    clean,
    dcdFetchPageProps,
    normalizeSeriesId,
    requireArray,
    requireStableId,
    requireText,
} from './utils.js';

/** Normalize a price field that may be a number (59.8) or a string ("51.00万"). */
function priceStr(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? `${v}万` : '';
    return clean(v);
}

/**
 * Pure parser: carModelsData + status → trim rows. Exported for unit tests.
 * status: 'online' (在售, default) or 'offline' (停售).
 */
export function parseModels(carModelsData, status) {
    const tabs = carModelsData?.tab_list;
    requireArray(tabs, 'dongchedi carModelsData.tab_list');
    if (tabs.length === 0) return [];
    const wantKey = status === 'offline' ? 'offline' : 'online_all';
    const tab = tabs.find((t) => t?.tab_key === wantKey)
        || (status === 'offline' ? tabs.find((t) => /停售/.test(t?.tab_text || '')) : tabs[0]);
    if (!tab) return [];
    const data = tab?.data;
    requireArray(data, `dongchedi models ${status} data`);

    const rows = [];
    for (const [index, d] of data.entries()) {
        const info = d?.info || {};
        const carId = info.car_id ?? info.id;
        if (!carId) continue; // skip model-year header rows
        rows.push({
            car_id: requireStableId(carId, `dongchedi models row ${index + 1}`),
            name: requireText(info.name || info.car_name, `dongchedi models row ${index + 1} name`),
            year: info.year != null ? String(info.year) : '',
            official_price: priceStr(info.official_price),
            dealer_price: priceStr(info.dealer_price),
            owner_price: priceStr(info.owner_price),
        });
    }
    return rows;
}

cli({
    site: 'dongchedi',
    name: 'models',
    access: 'read',
    aliases: ['trims'],
    description: '懂车帝车系款型列表（car_id / 名称 / 年款 / 指导价 / 经销商价 / 车主成交价）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'series_id', required: true, positional: true, help: '车系 ID（来自 search 的 series_id，或 /auto/series/<id> URL）' },
        { name: 'status', default: 'online', help: '在售 online（默认）或停售 offline' },
    ],
    columns: MODELS_COLUMNS,
    func: async (args) => {
        const seriesId = normalizeSeriesId(args.series_id);
        const status = String(args.status || 'online').trim().toLowerCase();
        if (status !== 'online' && status !== 'offline') {
            throw new ArgumentError('status', "must be 'online' (在售) or 'offline' (停售)");
        }
        const pp = await dcdFetchPageProps(`/auto/series/${seriesId}`, `models ${seriesId}`);
        const rows = parseModels(pp.carModelsData, status);
        if (rows.length === 0) {
            const message = status === 'offline' ? 'No discontinued trims listed for this series.' : 'No on-sale trims listed for this series.';
            const ErrorCtor = status === 'offline' ? EmptyResultError : CommandExecutionError;
            throw new ErrorCtor(
                `dongchedi models ${seriesId} (${status})`,
                message,
            );
        }
        return rows;
    },
});
