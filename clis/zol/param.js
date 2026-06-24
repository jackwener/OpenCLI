/**
 * zol param — full parameter sheet (参数/规格) for a product.
 *
 * Hits `detail.zol.com.cn/0/<productId>/param.shtml` (the subcategory segment
 * is cosmetic, so a constant `0` works) and reads the spec table. Each row is
 * a `<span id="newPmName_N">字段</span>` paired by index with a
 * `<span id="newPmVal_N">值</span>`, e.g. 长度 → 146.7mm, 电池 → 3279mAh.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    ZOL_DETAIL,
    PARAM_COLUMNS,
    stripHtml,
    normalizeProductId,
    zolFetch,
} from './utils.js';

/**
 * Pure parser: param HTML → [{field, value}] rows. Exported for unit testing.
 *
 * The newPmName_N / newPmVal_N spans appear in document order (name then
 * value) and share the index N, so a back-referenced regex pairs them
 * unambiguously. Values may trail extra markup (units, a 纠错 link) — the
 * non-greedy capture stops at the first `</span>`, then tags are stripped.
 */
export function parseParamRows(html) {
    const text = String(html || '');
    const ROW_RE =
        /<span id="newPmName_(\d+)"[^>]*>([\s\S]*?)<\/span>[\s\S]*?<span id="newPmVal_\1"[^>]*>([\s\S]*?)<\/span>/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = ROW_RE.exec(text)) !== null) {
        const field = stripHtml(m[2]);
        // Strip ZOL's "查看…>" / "更多>" link-label affordances and the lone
        // `>` separators the site appends to each linked tag — they are UI
        // chrome, not spec data (real spec values never contain an ASCII `>`).
        const value = stripHtml(m[3])
            .replace(/查看[^>＞]{0,12}[>＞]/g, '')
            .replace(/[>＞]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!field || !value) continue;
        const key = `${field}|${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ field, value });
    }
    return rows;
}

cli({
    site: 'zol',
    name: 'param',
    access: 'read',
    description: '中关村在线产品参数（按产品 id 返回完整规格表：尺寸/屏幕/电池/处理器等）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品 id（来自 search 的 product_id 列）或 detail.zol.com.cn 详情页 URL' },
    ],
    columns: PARAM_COLUMNS,
    func: async (args) => {
        const productId = normalizeProductId(args.product);
        const html = await zolFetch(
            `${ZOL_DETAIL}/0/${productId}/param.shtml`,
            `param ${productId}`,
        );
        const rows = parseParamRows(html);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `zol param ${productId}`,
                'No spec rows found — the product id may not exist or ZOL changed its param page.',
            );
        }
        return rows;
    },
});
