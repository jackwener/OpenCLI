/**
 * pconline param — full parameter sheet (参数/规格) for a product.
 *
 * Hits `product.pconline.com.cn/<cat>/<brand>/<id>_detail.html` and reads the
 * spec table inside `area-detailparams`. Each row is a
 * `<tr itemid="N"><th>字段</th><td>值</td></tr>`; values may carry glossary
 * `poptxt` links and `<br>` separators, which are flattened to plain text.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    PARAM_COLUMNS,
    stripHtml,
    normalizeProduct,
    productBase,
    pcFetch,
} from './utils.js';

/**
 * Pure parser: 参数 HTML → [{field, value}] rows. Exported for unit testing.
 *
 * Scopes to the `area-detailparams` section (cut before the sibling
 * record/related/similar areas so their tables aren't scraped), then pairs
 * each `<th>` with its `<td>`. Section-header rows (a `<th>` with no `<td>`)
 * don't match and are skipped. Rows are deduped by field+value.
 */
export function parseParamRows(html) {
    const text = String(html || '');
    const start = text.indexOf('area-detailparams');
    if (start < 0) return [];
    let seg = text.slice(start);
    const end = seg.search(/class="area area-(record|relatedinfo|similar)/);
    if (end > 0) seg = seg.slice(0, end);

    const ROW_RE = /<tr[^>]*>\s*<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = ROW_RE.exec(seg)) !== null) {
        const field = stripHtml(m[1]);
        // Drop the poptxt glossary popups (`<div class="tips">…是什么 / 查看所有…</div>`)
        // and the CPU/GPU "天梯图" affordance — UI chrome, not spec data. Then
        // collapse an exactly-doubled value (some cells render the price twice).
        const value = stripHtml(m[2].replace(/<div class="tips">[\s\S]*?<\/div>/g, ''))
            .replace(/\s*点击型号查看完整天梯图\s*/g, '')
            .replace(/^(.+?)\s+\1$/, '$1')
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
    site: 'pconline',
    name: 'param',
    access: 'read',
    aliases: ['spec', 'specs'],
    description: '太平洋电脑网产品参数（按产品 URL 返回完整规格表：屏幕/电池/处理器/接口等）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品详情 URL 或 <品类>/<品牌>/<id>（来自 list 的 url 列）' },
    ],
    columns: PARAM_COLUMNS,
    func: async (args) => {
        const p = normalizeProduct(args.product);
        const html = await pcFetch(`${productBase(p)}_detail.html`, `param ${p.id}`);
        const rows = parseParamRows(html);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `pconline param ${p.category}/${p.brand}/${p.id}`,
                'No spec rows found — the product URL may be wrong or PConline changed its param page.',
            );
        }
        return rows;
    },
});
