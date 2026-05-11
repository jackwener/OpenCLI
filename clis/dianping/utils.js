/**
 * Shared helpers for dianping (大众点评) adapters.
 *
 * Mobile m.dianping.com is intentionally crippled to push users to the
 * native app — body renders as 2 chars when probed from desktop UA.
 * www.dianping.com (PC site) returns the full search HTML server-side
 * and does NOT require JS hydration, so adapters target it directly.
 */

import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

/**
 * Common Chinese cities → dianping cityId.
 * Source: dianping.com /citylist URL structure (cityId is the integer in
 * the search path: /search/keyword/{cityId}/0_keyword).
 */
export const CITY_ID = {
    beijing: 2, '北京': 2,
    shanghai: 1, '上海': 1,
    guangzhou: 4, '广州': 4,
    shenzhen: 7, '深圳': 7,
    hangzhou: 3, '杭州': 3,
    chengdu: 8, '成都': 8,
    chongqing: 9, '重庆': 9,
    nanjing: 5, '南京': 5,
    suzhou: 6, '苏州': 6,
    xian: 17, '西安': 17,
    wuhan: 16, '武汉': 16,
    tianjin: 10, '天津': 10,
    qingdao: 21, '青岛': 21,
    changsha: 344, '长沙': 344,
    dalian: 19, '大连': 19,
    shenyang: 18, '沈阳': 18,
    kunming: 25, '昆明': 25,
    fuzhou: 110, '福州': 110,
    xiamen: 14, '厦门': 14,
    hefei: 26, '合肥': 26,
};

export const SEARCH_COLUMNS = ['rank', 'shop_id', 'name', 'rating', 'reviews', 'price', 'cuisine', 'district', 'url'];
export const SHOP_COLUMNS = ['field', 'value'];

/**
 * Resolve a city argument (name or id) to a numeric cityId.
 * Returns null when the cookie's default city should be used.
 */
export function resolveCityId(cityArg) {
    if (cityArg == null || cityArg === '') return null;
    const raw = String(cityArg).trim().toLowerCase();
    if (/^\d+$/.test(raw)) return Number(raw);
    const id = CITY_ID[raw];
    if (!id) {
        const names = Object.keys(CITY_ID).filter((k) => /^[a-z]+$/.test(k)).join(', ');
        throw new ArgumentError(
            'city',
            `unknown city '${cityArg}'. pass a numeric cityId or one of: ${names}`,
        );
    }
    return id;
}

export function requireSearchLimit(value) {
    const raw = value == null || value === '' ? 15 : value;
    const limit = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(limit) || limit < 1 || limit > 15) {
        throw new ArgumentError('limit must be an integer between 1 and 15 (dianping single page)');
    }
    return limit;
}

export function normalizeShopId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('shop_id must be a non-empty string');

    const idMatch = raw.match(/\/shop\/([^?#/]+)/);
    const shopId = idMatch ? idMatch[1] : raw;
    if (!/^[A-Za-z0-9_-]+$/.test(shopId)) {
        throw new ArgumentError(`'${raw}' does not look like a dianping shop id`);
    }
    return shopId;
}

export function wrapDianpingStep(label, fn) {
    return Promise.resolve()
        .then(fn)
        .catch((err) => {
            if (err?.code) throw err;
            const message = err?.message || String(err);
            throw new CommandExecutionError(`dianping ${label} failed: ${message}`);
        });
}

/**
 * Throw the right typed error for a dianping page that didn't render data.
 * The site short-circuits HTML when bot/login checks trip — typically
 * redirects to verify.meituan.com (Yoda icon-tap captcha) or to a login
 * page when the cookie is missing.
 */
export function detectAuthOrPageFailure({ text = '', url = '' }, contextHint, { emptyPatterns = [] } = {}) {
    const signal = `${url} ${text}`;
    if (/verify\.meituan\.com|verifyimg|身份核实|请依次点击|美团安全验证|Yoda/i.test(signal)) {
        throw new AuthRequiredError(
            'dianping.com',
            `dianping ${contextHint} blocked by captcha — open ${url || 'www.dianping.com'} manually in this profile and solve the captcha, then retry`,
        );
    }
    if (/login\.dianping\.com|account\.dianping\.com|请先登录|未登录|请登录/.test(signal)) {
        throw new AuthRequiredError(
            'dianping.com',
            `dianping ${contextHint} requires login — sign in to dianping.com in this profile, then retry`,
        );
    }
    if (emptyPatterns.some((pattern) => pattern.test(signal))) {
        throw new EmptyResultError(`dianping ${contextHint}`);
    }
    const sample = text ? `; sample: ${String(text).slice(0, 160)}` : '';
    throw new CommandExecutionError(
        `dianping ${contextHint} did not render expected data${sample}`,
        'This usually means dianping changed its HTML, returned an unexpected error page, or the browser profile hit an unrecognized anti-bot state.',
    );
}

/**
 * Parse "21231" / "1.2万" review-count strings into integers.
 * Returns null when the input has no parseable digits.
 */
export function parseReviewCount(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const wanMatch = s.match(/^([\d.]+)\s*万/);
    if (wanMatch) {
        const n = Number(wanMatch[1]);
        return Number.isFinite(n) ? Math.round(n * 10000) : null;
    }
    const plainMatch = s.match(/(\d+(?:\.\d+)?)/);
    if (!plainMatch) return null;
    const n = Number(plainMatch[1]);
    return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Parse "￥109" / "¥109" / "人均￥109" into a numeric yuan value.
 * Returns null when no price is present (some shops omit price entirely).
 */
export function parsePrice(raw) {
    if (!raw) return null;
    const m = String(raw).match(/[¥￥]\s*(\d+(?:\.\d+)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
}
