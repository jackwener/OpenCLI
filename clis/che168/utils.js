/**
 * Shared helpers for the 汽车之家二手车 / 车168 (che168) adapter.
 *
 * che168 has two very different surfaces:
 *
 *  1. The new-car **spec/config** data is served by an open, login-free cache
 *     API (`cacheapigo.che168.com/CarProduct/GetParam.ashx?specid=<id>`) that
 *     returns GBK-encoded JSON. The `spec` command reads this directly
 *     (Strategy.PUBLIC, no browser).
 *
 *  2. The **used-car** listing/detail pages (`www.che168.com` / `m.che168.com`)
 *     are fully gated behind a 瑞数 (Riversafe) JS challenge — a bare `fetch`
 *     only ever gets back a ~29KB challenge shell, never a listing. So the
 *     `browse` / `car` commands run in the logged-in browser (Strategy.DOM,
 *     `browser: true`), where the challenge clears naturally, and extract the
 *     rendered DOM.
 */

import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

export const CHE168_WWW_BASE = 'https://www.che168.com';
export const CHE168_M_BASE = 'https://m.che168.com';
export const PARAM_API = 'https://cacheapigo.che168.com/CarProduct/GetParam.ashx';

const UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

export const SPEC_COLUMNS = ['group', 'field', 'value'];
export const BROWSE_COLUMNS = ['rank', 'info_id', 'title', 'price', 'reg_date', 'mileage', 'city', 'url'];
export const CAR_COLUMNS = ['field', 'value'];

export function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Common city name / code → che168 city pinyin slug (the path segment in
 * www.che168.com/<slug>/list/). che168 uses full pinyin, not the 2-letter
 * codes guazi uses.
 */
export const CITY_SLUG = {
    bj: 'beijing', '北京': 'beijing',
    sh: 'shanghai', '上海': 'shanghai',
    gz: 'guangzhou', '广州': 'guangzhou',
    sz: 'shenzhen', '深圳': 'shenzhen',
    hz: 'hangzhou', '杭州': 'hangzhou',
    cd: 'chengdu', '成都': 'chengdu',
    cq: 'chongqing', '重庆': 'chongqing',
    nj: 'nanjing', '南京': 'nanjing',
    wh: 'wuhan', '武汉': 'wuhan',
    tj: 'tianjin', '天津': 'tianjin',
    xa: 'xian', '西安': 'xian',
    su: 'suzhou', '苏州': 'suzhou',
    cs: 'changsha', '长沙': 'changsha',
    qd: 'qingdao', '青岛': 'qingdao',
    zz: 'zhengzhou', '郑州': 'zhengzhou',
    hf: 'hefei', '合肥': 'hefei',
};

/** Resolve a city arg (name, 2-letter code, or pinyin) to a che168 slug; default beijing. */
export function resolveCity(cityArg) {
    if (cityArg == null || cityArg === '') return 'beijing';
    const raw = String(cityArg).trim();
    if (CITY_SLUG[raw]) return CITY_SLUG[raw];
    const lower = raw.toLowerCase();
    if (CITY_SLUG[lower]) return CITY_SLUG[lower];
    if (/^[a-z]{3,}$/.test(lower)) return lower; // already a pinyin slug
    const names = [...new Set(Object.values(CITY_SLUG))].join(', ');
    throw new ArgumentError('city', `unknown city '${cityArg}'. pass a che168 city pinyin or one of: ${names}`);
}

/**
 * Normalize a che168/autohome spec id: a bare number, a `.../spec/<id>/` URL,
 * or a `?specid=<id>` query value.
 */
export function normalizeSpecId(rawInput) {
    const raw = String(rawInput ?? '').trim();
    if (!raw) throw new ArgumentError('specid must be a non-empty value');
    const m = raw.match(/specid[=/](\d+)/i) || raw.match(/spec[/_-](\d+)/i) || raw.match(/^(\d+)$/);
    if (!m) {
        throw new ArgumentError(
            `'${rawInput}' does not look like a che168/autohome specid (a number, or a .../spec/<id>/ URL)`,
        );
    }
    return m[1];
}

/**
 * Extract a che168 used-car listing id (infoid) for display: a bare number or
 * a `.../<infoid>.html` detail URL.
 */
export function normalizeInfoId(rawInput) {
    const raw = String(rawInput ?? '').trim();
    if (!raw) throw new ArgumentError('info_id must be a non-empty value');
    const m = raw.match(/(\d{5,})\.html/) || raw.match(/infoid=(\d+)/i) || raw.match(/^(\d+)$/);
    if (!m) {
        throw new ArgumentError(
            `'${rawInput}' does not look like a che168 listing id (a number, or a /.../<infoid>.html URL)`,
        );
    }
    return m[1];
}

/**
 * Resolve the navigable desktop detail URL for `car`. che168's desktop detail
 * page needs the dealer-qualified path (`/dealer/<dealer>/<infoid>.html`) — a
 * bare infoid redirects to an error page — so the input must be the full URL
 * (or `/dealer/.../<id>.html` path) that `browse` surfaces in its `url` column.
 */
export function resolveCarUrl(rawInput) {
    const raw = String(rawInput ?? '').trim();
    if (!raw) throw new ArgumentError('a che168 detail URL (from `che168 browse`) is required');
    let m = raw.match(/che168\.com(\/dealer\/\d+\/\d+\.html)/i);
    if (m) return `${CHE168_WWW_BASE}${m[1]}`;
    m = raw.match(/^\/?(dealer\/\d+\/\d+\.html)/i);
    if (m) return `${CHE168_WWW_BASE}/${m[1]}`;
    if (/^https?:\/\/[^\s]*che168\.com\/.*\d{5,}\.html/i.test(raw)) return raw.replace(/^http:/i, 'https:').split('#')[0];
    throw new ArgumentError(
        `'${rawInput}' is not a navigable che168 detail URL. Pass the full url from \`che168 browse\` `
        + '(e.g. https://www.che168.com/dealer/<dealer>/<infoid>.html) — a bare info id cannot reach the desktop detail page.',
    );
}

/** Fetch a GBK-encoded che168 cache-API endpoint and parse it as JSON. */
export async function che168GetJson(url, contextHint) {
    let resp;
    try {
        resp = await fetch(url, {
            headers: {
                'User-Agent': UA,
                'Accept-Language': 'zh-CN,zh;q=0.9',
                Referer: `${CHE168_M_BASE}/`,
            },
        });
    } catch (err) {
        throw new CommandExecutionError(`che168 ${contextHint} network error: ${err?.message || err}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`che168 ${contextHint} HTTP ${resp.status}`);
    }
    const buf = await resp.arrayBuffer();
    // che168 cache-API responses are GBK, not UTF-8.
    const text = new TextDecoder('gbk').decode(buf);
    if (/瑞数|reese84|安全验证|滑动验证/i.test(text) && !/returncode/i.test(text)) {
        throw new AuthRequiredError(
            'che168.com',
            `che168 ${contextHint} hit an anti-bot challenge.`,
        );
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new CommandExecutionError(`che168 ${contextHint} returned non-JSON (possibly anti-bot or schema change)`);
    }
}

export { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError };
