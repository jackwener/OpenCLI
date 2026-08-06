/**
 * guazi search — brand-filtered used-car search, by brand + city.
 *
 * Like `browse`, this reads the mobile SSR site (`m.guazi.com`), which renders
 * the full listing into HTML with no login, no signature, and no anti-bot
 * challenge. Where `browse` lists a whole city (`/<city>/buy/`), `search` hits
 * the brand-filtered path `/<city>/<brand-slug>/`, so you can pull just the
 * 宝马 / 比亚迪 / 理想 … listings.
 *
 * (The DESKTOP www.guazi.com brand pages render the same data but sit behind a
 * captcha that trips on direct navigation even when logged in, so the reliable
 * route is the mobile SSR — same as `browse`.)
 *
 * Listing rows come from the shared `parseListings` (see browse.js), which is
 * already unit-tested and throws on malformed cards; here we additionally
 * freeze a brand-page fixture to prove the brand path has the same SSR shape.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    BROWSE_COLUMNS,
    CommandExecutionError,
    guaziFetch,
    requireLimit,
    resolveBrandSlug,
    resolveCityCode,
} from './utils.js';
import { parseListings } from './browse.js';

cli({
    site: 'guazi',
    name: 'search',
    access: 'read',
    aliases: ['find'],
    description: '瓜子二手车按品牌+城市筛选搜索（宝马/比亚迪/理想…，免登录移动端 SSR）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'brand', positional: true, required: true, help: '品牌中文名（宝马/奔驰/比亚迪/理想/特斯拉…）或 guazi 品牌 slug' },
        { name: 'city', help: '城市名或 guazi 城市码（北京/bj、上海/sh…）。默认 bj' },
        { name: 'limit', type: 'int', default: 20, help: '返回的车源数量（最多 40，单页 SSR 上限）' },
    ],
    columns: BROWSE_COLUMNS,
    func: async (args) => {
        const code = resolveCityCode(args.city);
        const brandSlug = resolveBrandSlug(args.brand);
        if (!brandSlug) {
            throw new ArgumentError('brand', 'a brand is required (use `guazi browse` for a whole city).');
        }
        const limit = requireLimit(args.limit, 20, 40);

        const html = await guaziFetch(`/${code}/${brandSlug}/`, `search ${code}/${brandSlug}`);
        const rows = parseListings(html, limit);
        if (rows.length === 0) {
            throw new CommandExecutionError(
                `guazi search ${code}/${brandSlug}`,
                'No SSR listing anchors on a successful Guazi page — the brand may have no stock in this city, '
                + 'the brand slug may be wrong, or the mobile layout changed.',
            );
        }
        return rows;
    },
});
