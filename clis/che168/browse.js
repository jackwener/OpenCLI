/**
 * che168 browse — list used cars for sale in a city.
 *
 * The used-car list page (`www.che168.com/<city>/list/`) is gated behind an
 * anti-bot JS challenge, so a bare `fetch` only returns the challenge shell.
 * This command navigates the page in the logged-in browser (where the
 * challenge clears) and extracts the rendered listing cards (`li.cards-li`).
 *
 * The DOM extractor is a plain top-level function injected via `.toString()`
 * into `page.evaluate`, so the same code is exercised by a JSDOM-against-frozen
 * -fixture unit test (see che168.test.js).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    AuthRequiredError,
    BROWSE_COLUMNS,
    CHE168_WWW_BASE,
    CommandExecutionError,
    EmptyResultError,
    resolveCity,
} from './utils.js';

/**
 * Pure DOM extractor for the che168 used-car list page. Uses bare `document`
 * so it runs identically in the live browser and in JSDOM unit tests.
 */
export function extractListings(limit) {
    const max = Number(limit) > 0 ? Number(limit) : 20;
    const cards = Array.from(document.querySelectorAll('li.cards-li'));
    const rows = [];
    const seen = {};
    for (const li of cards) {
        let infoId = '';
        const idm = (li.getAttribute('id') || '').match(/(\d{5,})/);
        if (idm) infoId = idm[1];
        const a = li.querySelector('a[href*=".html"]');
        const href = a ? (a.getAttribute('href') || '') : '';
        if (!infoId) {
            const hm = href.match(/(\d{5,})\.html/);
            if (hm) infoId = hm[1];
        }
        if (!infoId || seen[infoId]) continue;

        const nameEl = li.querySelector('.card-name');
        const title = nameEl ? nameEl.textContent.replace(/\s+/g, ' ').trim() : '';
        if (!title) continue;
        seen[infoId] = 1;

        // "0.47万公里／2025-09／北京／1年黄金会员"
        const unitEl = li.querySelector('.cards-unit');
        const unit = unitEl ? unitEl.textContent.replace(/\s+/g, ' ').trim() : '';
        const parts = unit.split(/[／/]/).map((s) => s.trim()).filter(Boolean);
        let mileage = '';
        let regDate = '';
        let city = '';
        for (const p of parts) {
            if (!mileage && /公里/.test(p)) mileage = p;
            else if (!regDate && /\d{4}/.test(p) && /[-年]/.test(p)) regDate = p;
            else if (!city && /^[一-龥]{2,8}$/.test(p) && !/会员|年/.test(p)) city = p;
        }

        const priceEm = li.querySelector('.cards-price-box em');
        const price = priceEm ? `${priceEm.textContent.trim()}万` : '';

        let url = href.split('?')[0].split('#')[0];
        if (url.startsWith('//')) url = `https:${url}`;
        else if (url.startsWith('/')) url = `https://www.che168.com${url}`;

        rows.push({
            rank: rows.length + 1,
            info_id: infoId,
            title,
            price,
            reg_date: regDate,
            mileage,
            city,
            url,
        });
        if (rows.length >= max) break;
    }
    return rows;
}

/** Read a short body sample (for classifying empty-vs-blocked). Keys are
 * deliberately non-column names so the silent-column-drop audit ignores it. */
function pageSample() {
    const body = document.body;
    const text = (body && (body.innerText || body.textContent)) || '';
    return { pageTitle: document.title || '', bodySample: text.replace(/\s+/g, ' ').slice(0, 600), pageUrl: location.href };
}

cli({
    site: 'che168',
    name: 'browse',
    access: 'read',
    aliases: ['list'],
    description: '车168/汽车之家二手车在售车源列表（按城市，含售价/上牌/里程）',
    domain: 'www.che168.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'city', positional: true, help: '城市名（北京/上海/...）或 che168 城市拼音（beijing/shanghai/...）。默认 beijing' },
        { name: 'limit', type: 'int', default: 20, help: '返回的车源数量（最多 50）' },
    ],
    columns: BROWSE_COLUMNS,
    func: async (page, args) => {
        const city = resolveCity(args.city);
        const n = Number(args.limit ?? 20);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
            throw new CommandExecutionError('limit must be an integer between 1 and 50');
        }

        const url = `${CHE168_WWW_BASE}/${city}/list/`;
        try {
            await page.goto(url);
            await page.wait(3);
        } catch (err) {
            throw new CommandExecutionError(`che168 browse ${city} navigation failed: ${err?.message || err}`);
        }

        const rows = await page.evaluate(`(${extractListings.toString()})(${n})`);
        if (!rows || rows.length === 0) {
            const info = await page.evaluate(`(${pageSample.toString()})()`);
            if (/验证|安全|滑动|登录/.test(info?.bodySample || '')) {
                throw new AuthRequiredError('che168.com', `che168 browse ${city} hit an anti-bot/login wall.`);
            }
            throw new EmptyResultError(`che168 browse ${city}`, 'No listings found — the city may be wrong or che168 changed its layout.');
        }
        return rows;
    },
});
