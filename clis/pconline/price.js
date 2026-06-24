/**
 * pconline price — price history / lowest tracked price for a product.
 *
 * Hits the public JSON API `ppc.pconline.com.cn/productPrice/list?pId=<id>`
 * (no login, no signature — a separate host from the rate-limited 产品库). The
 * response carries the 30-day lowest tracked price (`cheapest`), the product's
 * SKUs and, per e-commerce mall, recent price points (`mall.jdList` 京东 /
 * `mall.snList` 苏宁). We surface the historical low plus each mall's latest
 * tracked price.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    PC_PPC,
    PRICE_COLUMNS,
    normalizeProductId,
    fmtDate,
    pcFetchJson,
} from './utils.js';

const MALL_LABEL = { jdList: '京东', snList: '苏宁' };

/**
 * Pure parser: price API JSON → [{mall, price, date}] rows. Exported for unit
 * testing against the frozen fixture.
 *
 * Emits a 历史最低价 row (from `cheapest`) followed by the latest tracked price
 * for each mall that has data points (the most recent entry by `time`).
 */
export function parsePriceRows(json) {
    const d = (json && json.data) || {};
    const rows = [];

    const ch = d.cheapest;
    if (ch && ch.price != null) {
        rows.push({ mall: '历史最低价', price: Number(ch.price), date: fmtDate(ch.date) });
    }

    const mall = d.mall || {};
    for (const [key, label] of Object.entries(MALL_LABEL)) {
        const list = Array.isArray(mall[key]) ? mall[key] : [];
        if (list.length === 0) continue;
        const latest = list.reduce((a, b) => (Number(b?.time || 0) > Number(a?.time || 0) ? b : a));
        if (latest?.price == null) continue;
        rows.push({ mall: label, price: Number(latest.price), date: fmtDate(latest.time) });
    }
    return rows;
}

cli({
    site: 'pconline',
    name: 'price',
    access: 'read',
    description: '太平洋电脑网价格走势（按产品 id/URL 返回历史最低价 + 京东/苏宁最新报价）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品 id 或详情 URL（来自 list / info / param）' },
    ],
    columns: PRICE_COLUMNS,
    func: async (args) => {
        const id = normalizeProductId(args.product);
        const json = await pcFetchJson(
            `${PC_PPC}/productPrice/list?pId=${id}&skuId=0&days=30&mallType=0`,
            `price ${id}`,
        );
        const rows = parsePriceRows(json);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `pconline price ${id}`,
                'No tracked price found — the product may be too new or the id may be wrong.',
            );
        }
        return rows;
    },
});
