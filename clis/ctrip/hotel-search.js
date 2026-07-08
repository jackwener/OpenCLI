/**
 * 携程酒店 list — search hotels by city + date range.
 *
 * Reads `window.__NEXT_DATA__.props.pageProps.initListData.hotelList` directly
 * from the SSR-rendered hotel listing page. Ctrip serves first 13 hotels
 * (10 organic + ~3 promoted) inline; `&pageSize=N` URL params are ignored
 * server-side so we cap default limit accordingly (see
 * `~/.opencli/sites/ctrip/notes.md`).
 *
 * Reuses the existing `mapHotelRow` + `pickHotelMapCoords` helpers from utils.js
 * so the column shape stays consistent if future variants (hotel-detail) also
 * project from the same `hotelInfo` shape.
 *
 * Anti-bot: not detected on first-page navigation (PR #1481 recon 2026-05-12).
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { mapHotelRow, parseCityId, parseIsoDate } from './utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 10;

function parseHotelLimit(raw) {
    if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

/**
 * Wait for SSR state to be populated, or detect a login/captcha gate.
 *
 * Ctrip occasionally serves a captcha redirect (`/captcha`) when traffic
 * looks bot-like; we catch that as AuthRequired so the agent can pop a
 * human session instead of looping on an empty extract.
 */
const WAIT_FOR_SSR_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '')) return 'captcha';
      const hotels = window.__NEXT_DATA__?.props?.pageProps?.initListData?.hotelList;
      if (Array.isArray(hotels)) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 5000);
  })
`;

const EXTRACT_HOTELS_JS = `
  (() => {
    const list = window.__NEXT_DATA__?.props?.pageProps?.initListData?.hotelList;
    if (!Array.isArray(list)) return null;
    return list;
  })()
`;

function assertCheckinBeforeCheckout(checkin, checkout) {
    if (Date.parse(checkin + 'T00:00:00Z') >= Date.parse(checkout + 'T00:00:00Z')) {
        throw new ArgumentError(`--checkin must be earlier than --checkout (got ${checkin} >= ${checkout})`);
    }
}

cli({
    site: 'ctrip',
    name: 'hotel-search',
    access: 'read',
    description: '搜索携程酒店列表（按城市 + 入住/离店日期）',
    domain: 'hotels.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'city', required: true, positional: true, help: 'Numeric Ctrip city ID (use `ctrip search` or `ctrip hotel-suggest` to discover)' },
        { name: 'checkin', required: true, help: 'Check-in date (YYYY-MM-DD)' },
        { name: 'checkout', required: true, help: 'Check-out date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of hotels (${MIN_LIMIT}-${MAX_LIMIT}); SSR first page returns ~13 entries` },
    ],
    columns: [
        'rank', 'hotelId', 'name', 'enName',
        'star', 'score', 'scoreLabel', 'reviewCount',
        'cityName', 'district', 'address',
        'lat', 'lon',
        'price', 'currency', 'url',
    ],
    func: async (page, kwargs) => {
        const cityId = parseCityId(kwargs.city);
        const checkin = parseIsoDate('checkin', kwargs.checkin);
        const checkout = parseIsoDate('checkout', kwargs.checkout);
        assertCheckinBeforeCheckout(checkin, checkout);
        const limit = parseHotelLimit(kwargs.limit);

        const url = `https://hotels.ctrip.com/hotels/list?city=${cityId}&checkin=${checkin}&checkout=${checkout}`;
        await page.goto(url);
        const waitResult = await page.evaluate(WAIT_FOR_SSR_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('hotels.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip hotel-search page did not expose SSR hotel list (state=${String(waitResult)})`);
        }
        const raw = await page.evaluate(EXTRACT_HOTELS_JS);
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip hotel-search returned malformed SSR hotel list');
        }
        if (raw.length === 0) {
            throw new EmptyResultError('ctrip hotel-search', `No hotels for city=${cityId} on ${checkin} → ${checkout}`);
        }
        const rows = raw
            .map((entry, i) => mapHotelRow(entry, i))
            .filter((row) => row.hotelId && row.name)
            .slice(0, limit);
        if (rows.length === 0) {
            throw new CommandExecutionError('Ctrip hotel-search SSR rows were missing required hotelId/name anchors');
        }
        return rows;
    },
});

export const __test__ = { parseHotelLimit, assertCheckinBeforeCheckout, WAIT_FOR_SSR_JS, EXTRACT_HOTELS_JS };
