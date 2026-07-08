/**
 * Async city → cityId resolver for dianping adapters.
 *
 * Wraps the synchronous static-map `resolveCityId` from utils.js and falls
 * back to a live lookup against www.dianping.com when the input is not in
 * the curated map. Resolves both pinyin slugs (e.g. "shantou") and Chinese
 * names (e.g. "汕头") by reading dianping itself, so the adapter no longer
 * has to ship a complete static city table.
 *
 * Strategy:
 *   1. Empty / null  → null  (let the cookie's default city stand).
 *   2. All-digits    → numeric cityId pass-through.
 *   3. Static map    → fast path, no network. Reuses utils.CITY_ID.
 *   4. Pinyin slug   → goto https://www.dianping.com/<slug>, parse the
 *                       cityId out of any /search/keyword/{id}/ link.
 *   5. Chinese name  → goto https://www.dianping.com/citylist, build a
 *                       Chinese-name → pinyin map, then resolve the slug
 *                       as in step 4.
 *
 * Resolved (input → cityId) pairs are memoized in a module-level Map so a
 * second search in the same process skips both navigations.
 */

import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { CITY_ID, resolveCityId } from './utils.js';

const CHINESE_RE = /^[一-龥]+$/;
const PINYIN_RE = /^[a-z]+$/;

const RESOLVE_CACHE = new Map();

/**
 * Reset the in-process resolver cache. Exposed for tests so each case
 * starts from a clean slate; production code never needs to call this.
 */
export function clearCityResolverCache() {
    RESOLVE_CACHE.clear();
}

/**
 * Async resolver. Falls back to live dianping pages only when the input
 * is not in the static map.
 *
 * @param {{ goto: Function, evaluate: Function }} page  page handle from the adapter func
 * @param {string|number|null|undefined} cityArg         user-supplied city (name, pinyin, or numeric id)
 * @returns {Promise<number|null>}                       numeric cityId, or null to use the cookie default
 */
export async function resolveCityIdAsync(page, cityArg) {
    if (cityArg == null || cityArg === '') return null;
    const raw = String(cityArg).trim();
    if (!raw) return null;
    if (/^\d+$/.test(raw)) return Number(raw);

    const lowered = raw.toLowerCase();

    // Fast path: reuse the synchronous static map. resolveCityId throws
    // ArgumentError when the input is unknown — that's the trigger to fall
    // back to dynamic resolution rather than surface the error to the user.
    try {
        const staticId = resolveCityId(raw);
        if (staticId != null) return staticId;
    } catch (err) {
        if (err?.code !== 'ARGUMENT') throw err;
    }

    if (RESOLVE_CACHE.has(lowered)) return RESOLVE_CACHE.get(lowered);
    if (RESOLVE_CACHE.has(raw)) return RESOLVE_CACHE.get(raw);

    let pinyin = null;
    if (PINYIN_RE.test(lowered)) {
        pinyin = lowered;
    } else if (CHINESE_RE.test(raw)) {
        pinyin = await lookupPinyinFromCitylist(page, raw);
        if (!pinyin) {
            const known = Object.keys(CITY_ID).filter((k) => /^[a-z]+$/.test(k)).join(', ');
            throw new ArgumentError(
                'city',
                `unknown city '${cityArg}'. pass a numeric cityId, a pinyin slug (e.g. shantou), `
                + `a Chinese name listed on dianping.com/citylist, or one of: ${known}`,
            );
        }
    } else {
        const known = Object.keys(CITY_ID).filter((k) => /^[a-z]+$/.test(k)).join(', ');
        throw new ArgumentError(
            'city',
            `unknown city '${cityArg}'. pass a numeric cityId, a pinyin slug (e.g. shantou), `
            + `a Chinese name listed on dianping.com/citylist, or one of: ${known}`,
        );
    }

    const cityId = await fetchCityIdByPinyin(page, pinyin);
    if (!cityId) {
        throw new CommandExecutionError(
            `dianping could not resolve cityId for '${cityArg}' (pinyin=${pinyin}); `
            + `the city page rendered without a /search/keyword/{id}/ link`,
        );
    }

    RESOLVE_CACHE.set(lowered, cityId);
    RESOLVE_CACHE.set(pinyin, cityId);
    if (CHINESE_RE.test(raw)) RESOLVE_CACHE.set(raw, cityId);
    return cityId;
}

/**
 * Read https://www.dianping.com/citylist and return a Chinese-name → pinyin
 * slug map for every city link present on the page. Used when the user
 * supplied a Chinese name that isn't in the static map.
 */
async function lookupPinyinFromCitylist(page, chineseName) {
    await page.goto('https://www.dianping.com/citylist');
    const map = await page.evaluate(`(${buildCitylistMap.toString()})()`);
    if (!map || typeof map !== 'object' || Object.keys(map).length === 0) {
        throw new CommandExecutionError(
            'dianping citylist did not render any city anchors; cannot resolve Chinese city names',
        );
    }
    if (map && typeof map === 'object' && map[chineseName]) {
        return String(map[chineseName]).toLowerCase();
    }
    return null;
}

/**
 * Pure DOM extractor for /citylist. Walks every anchor on the page and
 * keeps the ones whose href matches the per-city slug shape and whose
 * text is a pure-Chinese label. Defined at module scope so the same code
 * can be exercised from JSDOM tests via toString() injection.
 */
export function buildCitylistMap() {
    const map = {};
    const anchors = document.querySelectorAll('a');
    anchors.forEach((a) => {
        const hrefRaw = a.getAttribute('href') || '';
        const text = ((a.textContent || '').trim());
        if (!text || !/^[一-龥]+$/.test(text)) return;
        const href = hrefRaw.replace(/^https?:/, '');
        const m = href.match(/^\/\/(?:www\.)?dianping\.com\/([a-z]+)\/?$/)
            || href.match(/^\/([a-z]+)\/?$/);
        if (!m) return;
        const slug = m[1].toLowerCase();
        // Filter out non-city slugs that share the shape (e.g. /citylist itself,
        // /promo, /events). Only register the first slug per Chinese label.
        if (slug === 'citylist' || slug === 'promo' || slug === 'events') return;
        if (!map[text]) map[text] = slug;
    });
    return map;
}

/**
 * Visit https://www.dianping.com/<slug> and pull the cityId out of any
 * /search/keyword/{id}/ anchor. The PC city landing page renders these
 * links server-side for every category card, so a single goto + DOM read
 * is enough — no extra clicks or hydration wait.
 */
async function fetchCityIdByPinyin(page, pinyin) {
    await page.goto(`https://www.dianping.com/${pinyin}`);
    const cityId = await page.evaluate(`(${extractCityIdFromPage.toString()})()`);
    return Number.isInteger(cityId) && cityId > 0 ? cityId : null;
}

/**
 * Pure DOM extractor for the per-city landing page. Defined at module
 * scope so the same code is exercised in JSDOM tests via toString().
 */
export function extractCityIdFromPage() {
    const baseHref = (typeof location !== 'undefined' && location.href) || 'https://www.dianping.com/';
    const anchors = document.querySelectorAll('a[href]');
    for (const a of anchors) {
        const hrefRaw = a.getAttribute('href') || '';
        let url;
        try {
            url = new URL(hrefRaw, baseHref);
        } catch {
            continue;
        }
        if (url.protocol !== 'https:') continue;
        if (url.hostname !== 'www.dianping.com' && url.hostname !== 'dianping.com') continue;
        const m = url.pathname.match(/^\/search\/keyword\/(\d+)(?:\/|$)/);
        if (!m) continue;
        const n = Number(m[1]);
        if (Number.isInteger(n) && n > 0) return n;
    }
    return null;
}
