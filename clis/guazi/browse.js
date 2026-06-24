/**
 * guazi browse — list used cars for sale in a city.
 *
 * Reads the mobile SSR list page `https://m.guazi.com/<city>/buy/`. Each
 * listing is an `<a href="/car-detail/c<clueId>.html">` whose `<img alt>`
 * holds the full title and whose visible text carries price / down-payment
 * / mileage / year / city. Parsing is a pure HTML→rows function (no DOM,
 * no network) so it runs identically in the unit test against a frozen page.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    BROWSE_COLUMNS,
    CommandExecutionError,
    GUAZI_M_BASE,
    clean,
    guaziFetch,
    requireStableId,
    requireText,
    requireLimit,
    resolveCityCode,
} from './utils.js';

/** Energy types Guazi tags on a card. */
const ENERGY = ['插电混动', '纯电动', '油电混动', '增程式', '汽油', '柴油'];

/**
 * Pure parser: list-page HTML → listing rows. Exported for unit testing.
 */
export function parseListings(html, limit) {
    const anchors = String(html || '').match(/<a[^>]+href="\/car-detail\/c\d+\.html"[\s\S]*?<\/a>/g) || [];
    const rows = [];
    const seen = new Set();
    for (const a of anchors) {
        const idM = a.match(/car-detail\/c(\d+)\.html/);
        if (!idM) continue;
        const clueId = requireStableId(idM[1], `guazi listing row ${rows.length + 1}`);
        if (seen.has(clueId)) continue;
        seen.add(clueId);

        const altM = a.match(/<img[^>]+alt="([^"]+)"/);
        const title = requireText(altM && altM[1], `guazi listing ${clueId} title`);

        const text = clean(a.replace(/<[^>]+>/g, ' '));
        const priceM = text.match(/(\d+(?:\.\d+)?)\s*万\s*首付/);
        const downM = text.match(/首付\s*(\d+(?:\.\d+)?)\s*万/);
        const mileM = text.match(/(\d+(?:\.\d+)?万公里|\d+公里)/);
        const yearM = text.match(/(\d{4})年/);
        // city sits between the mileage and the price ("… ｜ 北京 6.85 万 首付 …")
        const cityM = text.match(/[｜|]\s*([^｜|]{1,8}?)\s+\d+(?:\.\d+)?\s*万\s*首付/);
        const energy = ENERGY.find((e) => text.includes(e)) || '';

        rows.push({
            rank: rows.length + 1,
            clue_id: clueId,
            title,
            price: priceM ? `${priceM[1]}万` : '',
            down_payment: downM ? `${downM[1]}万` : '',
            mileage: mileM ? mileM[1] : '',
            year: yearM ? yearM[1] : '',
            city: cityM ? clean(cityM[1]) : energy,
            url: `${GUAZI_M_BASE}/car-detail/c${clueId}.html`,
        });
        if (rows.length >= limit) break;
    }
    return rows;
}

cli({
    site: 'guazi',
    name: 'browse',
    access: 'read',
    aliases: ['list'],
    description: '瓜子二手车在售车源列表（按城市，含售价/首付/里程/年份）',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'city', positional: true, help: '城市名（北京/上海/...）或瓜子城市码（bj/sh/...）。默认 bj 北京' },
        { name: 'limit', type: 'int', default: 20, help: '返回的车源数量（最多 40，单页 SSR 上限）' },
    ],
    columns: BROWSE_COLUMNS,
    func: async (args) => {
        const code = resolveCityCode(args.city);
        const limit = requireLimit(args.limit, 20, 40);
        const html = await guaziFetch(`/${code}/buy/`, `browse ${code}`);
        const rows = parseListings(html, limit);
        if (rows.length === 0) {
            throw new CommandExecutionError(
                `guazi browse ${code}`,
                'No SSR listing anchors found on a successful Guazi mobile page; the mobile layout may have changed.',
            );
        }
        return rows;
    },
});
