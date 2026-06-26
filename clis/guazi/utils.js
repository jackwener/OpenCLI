/**
 * Shared helpers for the 瓜子二手车 (Guazi) used-car adapter.
 *
 * The desktop www.guazi.com SPA renders an empty shell and loads listings
 * from a signature-locked API (`mapi.guazi.com`, rejects unsigned requests
 * with 签名验证失败). The MOBILE site `m.guazi.com`, however, server-side
 * renders the full listing list and car detail into the HTML with no login,
 * no signature, and no anti-bot challenge — so this adapter reads the mobile
 * SSR HTML with an iPhone UA.
 *
 * Limitation: deep pagination and brand/keyword filtering route through the
 * signed API, so `browse` returns the first SSR page (~40 fresh listings) for
 * a city. That is surfaced honestly rather than faked.
 */

import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const GUAZI_M_BASE = 'https://m.guazi.com';

const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

export const BROWSE_COLUMNS = ['rank', 'clue_id', 'title', 'price', 'down_payment', 'mileage', 'year', 'city', 'url'];
export const CAR_COLUMNS = ['field', 'value'];

/**
 * Common city → Guazi city code (the path segment in m.guazi.com/<code>/buy/).
 */
export const CITY_CODE = {
    beijing: 'bj', '北京': 'bj',
    shanghai: 'sh', '上海': 'sh',
    guangzhou: 'gz', '广州': 'gz',
    shenzhen: 'sz', '深圳': 'sz',
    hangzhou: 'hz', '杭州': 'hz',
    chengdu: 'cd', '成都': 'cd',
    chongqing: 'cq', '重庆': 'cq',
    nanjing: 'nj', '南京': 'nj',
    wuhan: 'wh', '武汉': 'wh',
    tianjin: 'tj', '天津': 'tj',
    xian: 'xa', '西安': 'xa',
    suzhou: 'su', '苏州': 'su',
    zhengzhou: 'zz', '郑州': 'zz',
    changsha: 'cs', '长沙': 'cs',
    qingdao: 'qd', '青岛': 'qd',
    shenyang: 'sy', '沈阳': 'sy',
    dalian: 'dl', '大连': 'dl',
    jinan: 'jn', '济南': 'jn',
    hefei: 'hf', '合肥': 'hf',
    foshan: 'fs', '佛山': 'fs',
};

/** Resolve a city arg (name or code) to a Guazi city code; defaults to bj. */
export function resolveCityCode(cityArg) {
    if (cityArg == null || cityArg === '') return 'bj';
    const raw = String(cityArg).trim().toLowerCase();
    if (CITY_CODE[raw]) return CITY_CODE[raw];
    if (CITY_CODE[String(cityArg).trim()]) return CITY_CODE[String(cityArg).trim()];
    if (/^[a-z]{2,3}$/.test(raw)) return raw; // already a code
    const names = Object.keys(CITY_CODE).filter((k) => /^[a-z]+$/.test(k)).join(', ');
    throw new ArgumentError('city', `unknown city '${cityArg}'. pass a Guazi city code or one of: ${names}`);
}

/** Normalize a clue id: a bare number or a /car-detail/c<id>.htm(l) URL. */
export function normalizeClueId(rawInput) {
    const raw = String(rawInput || '').trim();
    if (!raw) throw new ArgumentError('clue_id must be a non-empty value');
    const m = raw.match(/car-detail\/c(\d+)/) || raw.match(/^c?(\d+)$/);
    if (!m) {
        throw new ArgumentError(`'${rawInput}' does not look like a guazi clue id (a number, or a /car-detail/c<id>.html URL)`);
    }
    return m[1];
}

export function requireLimit(value, def, max) {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`limit must be an integer between 1 and ${max}`);
    }
    return n;
}

export function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

export function requireText(value, label) {
    const text = clean(value);
    if (!text) throw new CommandExecutionError(`${label} did not include a stable text value.`);
    return text;
}

export function requireStableId(value, label) {
    const id = String(value ?? '').trim();
    if (!/^\d+$/.test(id)) throw new CommandExecutionError(`${label} did not include a stable numeric id.`);
    return id;
}

/** Fetch a Guazi mobile page as HTML text, throwing typed errors. */
export async function guaziFetch(path, contextHint) {
    let resp;
    try {
        resp = await fetch(`${GUAZI_M_BASE}${path}`, {
            headers: {
                'User-Agent': UA,
                Referer: `${GUAZI_M_BASE}/`,
                'Accept-Language': 'zh-CN,zh;q=0.9',
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`guazi ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`guazi ${contextHint} HTTP ${resp.status}`);
    }
    const html = await resp.text();
    // Guazi may eventually push the mobile pages behind their JS challenge.
    if (/瑞数|reese84|captcha|滑动验证|verify\.guazi|安全验证/i.test(html) && !/car-detail\/c\d+/.test(html)) {
        throw new AuthRequiredError(
            'guazi.com',
            `guazi ${contextHint} hit an anti-bot challenge — Guazi may have started gating the mobile site.`,
        );
    }
    return html;
}

export { ArgumentError, CommandExecutionError, EmptyResultError };
