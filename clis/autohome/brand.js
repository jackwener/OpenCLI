/**
 * autohome brand — list a brand's car series with guide prices.
 *
 * Fetches the brand catalog page `grade/carhtml/<INITIAL>.html` (UTF-8, fully
 * server-rendered), isolates the `<dl>` block whose `<dt>` names the brand,
 * and reads each `<li id="s<seriesId>">` series + its 指导价. Pure HTML→rows
 * so it is unit-tested against a frozen catalog slice.
 *
 * This is Autohome's login-free "search": you search by brand (the catalog is
 * brand-organized). Free-text model search is signature-gated and not offered;
 * for that, use `dongchedi search`.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    AH_BASE,
    BRAND_COLUMNS,
    CommandExecutionError,
    EmptyResultError,
    ahFetch,
    clean,
    requireLimit,
    requireStableId,
    requireText,
    resolveBrandInitial,
} from './utils.js';

/**
 * Pure parser: catalog HTML + brand name → series rows. Exported for tests.
 */
export function parseBrandSeries(html, brandName, limit) {
    const source = String(html || '');
    const blocks = source.match(/<dl[^>]*>[\s\S]*?<\/dl>/g);
    if (!blocks) {
        throw new CommandExecutionError('autohome brand catalog returned an unexpected HTML shape; expected brand <dl> blocks.');
    }
    const want = String(brandName || '').replace(/[·\s]/g, '');

    // No brand name (single-letter catalog mode): scan the whole page.
    // Otherwise isolate the <dl> block whose <dt> names the brand.
    let block = html;
    if (want) {
        block = null;
        for (const b of blocks) {
            const nameM = b.match(/<dt>[\s\S]*?<div>\s*<a[^>]*>([^<]+)<\/a>/);
            const name = nameM ? clean(nameM[1]).replace(/[·\s]/g, '') : '';
            if (name && (name === want || name.startsWith(want) || want.startsWith(name))) {
                block = b;
                break;
            }
        }
        if (!block) return [];
    }

    const rows = [];
    const liRe = /<li id="s(\d+)">([\s\S]*?)<\/li>/g;
    let m;
    while ((m = liRe.exec(block)) !== null) {
        const seriesId = requireStableId(m[1], `autohome brand row ${rows.length + 1}`);
        const li = m[2];
        const nameM = li.match(/<h4>\s*<a[^>]*>([^<]+)<\/a>/) || li.match(/<a[^>]*>([^<]+)<\/a>/);
        const name = requireText(nameM && nameM[1], `autohome brand row ${rows.length + 1} name`);
        const priceM = li.match(/指导价[：:]\s*<[^>]*>([^<]+)</) || li.match(/指导价[：:]\s*([^<]+)</);
        let price = clean(priceM && priceM[1]);
        if (/暂无|未上市|停售/.test(price)) price = '';
        rows.push({
            series_id: seriesId,
            name,
            price,
            url: `${AH_BASE}/${seriesId}/`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'autohome',
    name: 'brand',
    access: 'read',
    aliases: ['series'],
    description: '汽车之家按品牌列出全部车系 + 厂商指导价（免登录）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'brand', required: true, positional: true, help: '品牌名（宝马 / 比亚迪 / 理想 / 丰田 …）或车系目录首字母 A-Z' },
        { name: 'limit', type: 'int', default: 60, help: '返回的车系数量（最多 120）' },
    ],
    columns: BRAND_COLUMNS,
    func: async (args) => {
        const brand = String(args.brand || '').trim();
        const initial = resolveBrandInitial(brand);
        const limit = requireLimit(args.limit, 60, 120);

        const html = await ahFetch(
            `${AH_BASE}/grade/carhtml/${initial}.html`,
            `brand ${brand}`,
        );
        const rows = parseBrandSeries(html, /^[A-Za-z]$/.test(brand) ? '' : brand, limit);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `autohome brand ${brand}`,
                `No series found for '${brand}'. Check the brand name spelling (simplified Chinese), or try a single A-Z catalog letter.`,
            );
        }
        return rows;
    },
});
