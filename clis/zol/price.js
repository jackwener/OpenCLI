/**
 * zol price — live e-commerce 报价 for a product.
 *
 * Hits `detail.zol.com.cn/0/<productId>/price.shtml` and reads the merchant
 * list. Each offer is a `brand-seller--main brand-mol-<platform>` block with
 * a `<span class="brand-name"><a title="商家">商家</a></span>` and a
 * `<a class="price"><font>￥</font>4399</a>` buy link.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_DETAIL,
    PRICE_COLUMNS,
    clean,
    normalizeProductId,
    zolFetch,
} from './utils.js';

const PLATFORM_LABEL = {
    jd: '京东', tmall: '天猫', taobao: '淘宝', suning: '苏宁',
    pinduoduo: '拼多多', amazon: '亚马逊', zol: 'ZOL',
};

/**
 * Pure parser: price HTML → merchant offer rows. Exported for unit testing.
 *
 * Splits on each `brand-seller--main` block, then pulls the platform slug
 * (`brand-mol-<x>`), the seller name (`brand-name` anchor) and the numeric
 * price (`class="price"` anchor, ignoring the ￥ font tag).
 */
export function parsePriceRows(html) {
    const text = String(html || '');
    const BLOCK_RE = /class="brand-seller--main\s+brand-mol-(\w+)[^"]*"[\s\S]*?(?=class="brand-seller--main|$)/g;
    const rows = [];
    let m;
    while ((m = BLOCK_RE.exec(text)) !== null) {
        const block = m[0];
        const slug = m[1];
        const sellerMatch = block.match(/class="brand-name"[^>]*>\s*<a[^>]*?(?:title="([^"]*)")?[^>]*>([^<]+)<\/a>/);
        const seller = clean(sellerMatch?.[1] || sellerMatch?.[2]);
        const priceMatch = block.match(/class="price"[^>]*>(?:<font>[^<]*<\/font>)?\s*([\d,]+)/);
        const buyMatch = block.match(/class="brand-buy-btn"[^>]*href="([^"]*)"/)
            || block.match(/<a[^>]*href="([^"]*)"[^>]*class="brand-buy-btn"/);
        if (!seller || !priceMatch) continue;
        rows.push({
            platform: PLATFORM_LABEL[slug] || slug,
            seller,
            price: Number(priceMatch[1].replace(/,/g, '')),
            url: clean(buyMatch?.[1]) || null,
        });
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'price',
    access: 'read',
    description: '中关村在线全网报价（按产品 id 返回各电商平台/商家的报价与购买链接）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品 id（来自 search 的 product_id 列）或 detail.zol.com.cn 详情页 URL' },
    ],
    columns: PRICE_COLUMNS,
    func: async (args) => {
        const productId = normalizeProductId(args.product);
        const html = await zolFetch(
            `${ZOL_DETAIL}/0/${productId}/price.shtml`,
            `price ${productId}`,
        );
        const rows = parsePriceRows(html);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `zol price ${productId}`,
                'No merchant offers found — the product may be discontinued or have no live listings.',
            );
        }
        return rows;
    },
});
