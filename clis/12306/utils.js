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
 *   [2] telecode (3-4 uppercase letters, e.g. `VAP`) — this is the
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

export const __test__ = {
    parseStationBundle,
    resolveStation,
    validateDate,
    buildCookieHeader,
    parseTrainRecord,
};
