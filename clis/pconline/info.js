/**
 * pconline info — product overview (名称 / 分类 / 品牌 / 重点参数).
 *
 * Hits the main detail page `product.pconline.com.cn/<cat>/<brand>/<id>.html`
 * and reads the product name (`<h1>`), the breadcrumb (category + brand) and
 * the 重点参数 highlight block (`keyparams`). Each highlight is a
 * `<span title="VALUE">名称：VALUE</span>`, so the link-free value comes
 * straight from the `title` attribute. It's the quick-look companion to the
 * exhaustive `param` sheet.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    INFO_COLUMNS,
    clean,
    stripHtml,
    normalizeProduct,
    productBase,
    pcFetch,
} from './utils.js';

/**
 * Pure parser: main-page HTML → [{field, value}] overview rows. Exported for
 * unit testing. Always emits 名称 + 分类 (+ 品牌 when derivable) followed by
 * the 重点参数 highlights.
 */
export function parseInfoRows(html) {
    const text = String(html || '');
    const rows = [];
    const seen = new Set();
    const push = (field, value) => {
        const f = clean(field);
        const v = clean(value);
        if (!f || !v || seen.has(f)) return;
        seen.add(f);
        rows.push({ field: f, value: v });
    };

    push('名称', stripHtml(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]));

    // Breadcrumb anchors: 首页 > 产品报价 > <类>大全 > <品牌><类>大全 > <product>
    const crumb = text.match(/class="crumb"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '';
    const segs = [...crumb.matchAll(/<a[^>]*>([^<]+)<\/a>/g)]
        .map((x) => clean(x[1]))
        .filter((s) => s && !/^(首页|产品报价|首页报价)$/.test(s));
    const catFull = segs.find((s) => s.endsWith('大全'));
    const category = catFull ? catFull.replace(/大全$/, '') : '';
    if (category) push('分类', category);
    const brandFull = segs[segs.length - 1];
    if (brandFull && brandFull !== catFull) {
        const brand = brandFull.replace(category, '').replace(/大全$/, '');
        if (brand) push('品牌', brand);
    }

    // 重点参数 highlights — scope to the keyparams block, read each `名称：值`
    // pair. The clean value is the span's `title` attr; when that's empty, fall
    // back to the text after the colon inside the span.
    const block = text.match(/class="block keyparams"[\s\S]*?<\/ul>/);
    if (block) {
        const SPAN_RE = /<span[^>]*\btitle="([^"]*)"[^>]*>([\s\S]*?)<\/span>/g;
        let s;
        while ((s = SPAN_RE.exec(block[0])) !== null) {
            const inner = stripHtml(s[2]);
            const idx = inner.search(/[：:]/);
            if (idx < 0) continue;
            const field = inner.slice(0, idx);
            const value = clean(s[1]) || inner.slice(idx + 1);
            push(field, value);
        }
    }
    return rows;
}

cli({
    site: 'pconline',
    name: 'info',
    access: 'read',
    aliases: ['overview'],
    description: '太平洋电脑网产品概览（名称 / 分类 / 品牌 / 重点参数，按产品 URL 返回）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'product', required: true, positional: true, help: '产品详情 URL 或 <品类>/<品牌>/<id>（来自 list 的 url 列）' },
    ],
    columns: INFO_COLUMNS,
    func: async (args) => {
        const p = normalizeProduct(args.product);
        const html = await pcFetch(`${productBase(p)}.html`, `info ${p.id}`);
        const rows = parseInfoRows(html);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `pconline info ${p.category}/${p.brand}/${p.id}`,
                'No overview parsed — the product URL may be wrong or the page layout changed.',
            );
        }
        return rows;
    },
});
