/**
 * 12306 (中国铁路) shared helpers.
 *
 * - Station lookup: parses the public `station_name.js` bundle into
 *   structured records.
 * - Cookie session: 12306's query endpoints reject anonymous requests
 *   with `HTTP 302 -> error.html`, so callers must hit `/otn/leftTicket/init`
 *   first to mint the JSESSIONID / route / BIGipServerotn cookies.
 * - Query endpoint rotation: 12306 rotates the train-query endpoint
 *   name (queryO / queryZ / queryA / queryG / ...) every few weeks.
 *   When the wrong name is hit, the server returns
 *   `{"c_url":"leftTicket/queryG","c_name":"CLeftTicketUrl","status":false}`
 *   pointing to the current correct name; retry once with that name.
 */
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const STATION_BUNDLE_URL = 'https://kyfw.12306.cn/otn/resources/js/framework/station_name.js';
const INIT_URL = 'https://kyfw.12306.cn/otn/leftTicket/init';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATION_CODE_RE = /^[A-Z]{2,4}$/;

/**
 * Parse the `station_name.js` bundle into a station record array.
 *
 * Bundle format (single line, `@`-delimited records, each `|`-delimited):
 *   `var station_names ='@bjb|北京北|VAP|beijingbei|bjb|0|0357|北京|||...';`
 *
 * Per-record fields (positional):
 *   [0] short pinyin alias  (e.g. `bjb`)
 *   [1] Chinese station name (e.g. `北京北`)
 *   [2] telecode (3-4 uppercase letters, e.g. `VAP`) - this is the
 *       wire format 12306 uses for `from_station` / `to_station`.
 *   [3] full pinyin           (e.g. `beijingbei`)
 *   [4] short alias           (duplicate of [0] usually)
 *   [5] index/rank
 *   [6] city code
 *   [7] city name             (e.g. `北京`)
 */
export function parseStationBundle(text) {
    const match = text.match(/'([^']+)'/);
    if (!match) {
        throw new CommandExecutionError('Failed to parse 12306 station_name.js: source string not found');
    }
    const raw = match[1];
    const records = raw.split('@').filter(Boolean);
    const stations = [];
    for (const r of records) {
        const parts = r.split('|');
        if (parts.length < 8 || !parts[2]) continue;
        stations.push({
            short: parts[0] || '',
            name: parts[1] || '',
            code: parts[2] || '',
            pinyin: parts[3] || '',
            abbr: parts[4] || '',
            city: parts[7] || '',
        });
    }
    if (stations.length === 0) {
        throw new CommandExecutionError('Failed to parse 12306 station_name.js: no station records found');
    }
    return stations;
}

/**
 * Resolve a user-supplied station identifier to a telecode.
 *
 * Accepts Chinese name (`上海虹桥`), telecode (`AOH`), pinyin
 * (`shanghaihongqiao`), short alias (`shh`), or city name with a
 * preference for the city's main station.
 */
export function resolveStation(stations, input) {
    const trimmed = String(input ?? '').trim();
    if (!trimmed) throw new ArgumentError('station must not be empty');
    if (STATION_CODE_RE.test(trimmed)) {
        const exact = stations.find((s) => s.code === trimmed);
        if (exact) return exact;
        throw new ArgumentError(`Unknown 12306 station telecode "${trimmed}"`);
    }
    const lower = trimmed.toLowerCase();
    const exactName = stations.find((s) => s.name === trimmed);
    if (exactName) return exactName;
    const exactPinyin = stations.find((s) => s.pinyin === lower);
    if (exactPinyin) return exactPinyin;
    const exactAbbr = stations.find((s) => s.abbr === lower || s.short === lower);
    if (exactAbbr) return exactAbbr;
    throw new ArgumentError(`Unknown 12306 station "${trimmed}"`, 'Try the Chinese name (上海虹桥), the 3-4 letter telecode (AOH), or full pinyin (shanghaihongqiao).');
}

export function validateDate(value) {
    if (!DATE_RE.test(String(value ?? ''))) {
        throw new ArgumentError(`date must be YYYY-MM-DD, got "${value}"`);
    }
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
        throw new ArgumentError(`date "${value}" is not a real calendar date`);
    }
    return value;
}

/** Extract Set-Cookie header values into a single `Cookie:` header string. */
export function buildCookieHeader(setCookieHeaders) {
    if (!Array.isArray(setCookieHeaders) || setCookieHeaders.length === 0) return '';
    return setCookieHeaders
        .map((line) => line.split(';')[0])
        .filter(Boolean)
        .join('; ');
}

export async function fetchStationBundle(fetchImpl = fetch) {
    const resp = await fetchImpl(STATION_BUNDLE_URL, {
        headers: { 'User-Agent': UA },
    });
    if (!resp.ok) {
        throw new CommandExecutionError(`Failed to fetch 12306 station bundle: HTTP ${resp.status}`);
    }
    return parseStationBundle(await resp.text());
}

/** Mint a 12306 anonymous session by hitting /otn/leftTicket/init. */
export async function mintSession(fetchImpl = fetch) {
    const resp = await fetchImpl(INIT_URL, {
        headers: { 'User-Agent': UA },
        redirect: 'follow',
    });
    if (!resp.ok) {
        throw new CommandExecutionError(`Failed to mint 12306 session: HTTP ${resp.status}`);
    }
    const setCookies = typeof resp.headers.getSetCookie === 'function'
        ? resp.headers.getSetCookie()
        : resp.headers.raw?.()['set-cookie'] || [];
    const cookieHeader = buildCookieHeader(setCookies);
    if (!cookieHeader) {
        throw new CommandExecutionError('12306 init returned no session cookies');
    }
    return cookieHeader;
}

/**
 * Twelve-row train query record (LEFT_TICKET_DTO).
 *
 * 12306 returns each train as a `|`-separated string with ~36 fields.
 * Positions used here come from the public web client; unused
 * positions are documented inline so future maintainers can extend
 * the row shape without re-reverse-engineering.
 */
export function parseTrainRecord(line, stationByCode) {
    const f = line.split('|');
    if (f.length < 33) return null;
    return {
        train_no: f[2] || '',
        code: f[3] || '',
        from_station: stationByCode.get(f[6])?.name || f[6] || '',
        to_station: stationByCode.get(f[7])?.name || f[7] || '',
        from_code: f[6] || '',
        to_code: f[7] || '',
        start_time: f[8] || '',
        arrive_time: f[9] || '',
        duration: f[10] || '',
        available: (f[1] || '').trim() === '预订' || (f[11] || '').trim() === 'Y',
        business_seat: f[32] || '',
        first_seat: f[31] || '',
        second_seat: f[30] || '',
        soft_sleeper: f[23] || '',
        hard_sleeper: f[28] || '',
        hard_seat: f[29] || '',
        no_seat: f[26] || '',
    };
}

/**
 * Mask helpers for sensitive identity fields rendered by 12306.
 *
 * 12306 already masks ID numbers and mobile numbers server-side
 * (`xxxx***********xxx` / `138****xxxx`); these helpers handle the
 * remaining fields (email, real Chinese name) so the adapter never
 * leaks unmasked PII without an explicit `--include-sensitive` opt-in.
 */
export function maskEmail(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    const at = v.indexOf('@');
    if (at <= 0) return v;
    const local = v.slice(0, at);
    const domain = v.slice(at);
    if (local.length <= 2) return local[0] + '*' + domain;
    return local[0] + '*'.repeat(Math.max(1, local.length - 2)) + local.slice(-1) + domain;
}

export function maskMobile(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (/\*/.test(v)) return v;
    if (v.length < 7) return v.replace(/.(?=.)/g, '*');
    return v.slice(0, 3) + '*'.repeat(v.length - 7) + v.slice(-4);
}

export function maskChineseName(value) {
    const v = String(value || '').trim();
    if (!v) return '';
    if (v.length === 1) return v;
    if (v.length === 2) return v[0] + '*';
    return v[0] + '*'.repeat(v.length - 2) + v.slice(-1);
}

export function unwrapEvaluateResult(value) {
    if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.prototype.hasOwnProperty.call(value, 'session')
        && Object.prototype.hasOwnProperty.call(value, 'data')
    ) {
        return value.data;
    }
    return value;
}

export function requireEvaluateObject(value, label) {
    const payload = unwrapEvaluateResult(value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError(`12306 ${label} returned a malformed browser payload`);
    }
    return payload;
}

export function isAuthLikePayload(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const parts = [];
    if (Array.isArray(payload.messages)) parts.push(...payload.messages);
    if (payload.message) parts.push(payload.message);
    if (payload.msg) parts.push(payload.msg);
    if (payload.validateMessages && typeof payload.validateMessages === 'object') {
        parts.push(...Object.values(payload.validateMessages).flat());
    }
    const text = parts.map((item) => String(item ?? '')).join(' ');
    return /未登录|登录|请登录|身份|认证|session|Session|login/i.test(text);
}

/**
 * Detect the 12306 login marker by reading `document.cookie` from the
 * current adapter page. Cannot use `page.getCookies({url})` here:
 * 12306 sets the auth cookie `tk` and `JSESSIONID` with `Path=/otn`,
 * and CDP `Network.getCookies` with a bare URL filter excludes
 * cookies whose path does not match the URL path. `document.cookie`
 * returns all non-httponly cookies visible to the current page
 * regardless of path, which is what we need to confirm login.
 */
export async function require12306Login(page, AuthRequiredErrorClass) {
    const docCookie = unwrapEvaluateResult(await page.evaluate(`document.cookie || ''`));
    const cookieStr = typeof docCookie === 'string' ? docCookie : '';
    if (!/\btk=/.test(cookieStr) || !/JSESSIONID=/.test(cookieStr)) {
        throw new AuthRequiredErrorClass('kyfw.12306.cn', 'Not logged into 12306. Sign in at https://kyfw.12306.cn first.');
    }
}

export const __test__ = {
    parseStationBundle,
    resolveStation,
    validateDate,
    buildCookieHeader,
    parseTrainRecord,
    maskEmail,
    maskMobile,
    maskChineseName,
    unwrapEvaluateResult,
    requireEvaluateObject,
    isAuthLikePayload,
};
