/**
 * Shared helpers for ctrip public destination/hotel suggestion endpoints.
 *
 * The single backing endpoint `https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine`
 * accepts a `searchType` discriminator:
 *   - `D` → destination suggest (cities, scenic spots, railway stations, landmarks)
 *   - `H` → hotel-context suggest (cities, business areas, individual hotels)
 *
 * Response shape is identical; we surface every field the endpoint emits as a
 * stable column so callers do not silently lose geo / English / id metadata.
 */
import { ArgumentError, CliError } from '@jackwener/opencli/errors';

const ENDPOINT = 'https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine';
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;

export function parseLimit(raw, fallback = 15) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

export async function fetchSuggest(query, searchType) {
    let response;
    try {
        response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                keyword: query,
                searchType,
                platform: 'online',
                pageID: '102001',
                head: {
                    Locale: 'zh-CN',
                    LocaleController: 'zh_cn',
                    Currency: 'CNY',
                    PageId: '102001',
                    clientID: 'opencli-ctrip',
                    group: 'ctrip',
                    Frontend: { sessionID: 1, pvid: 1 },
                    HotelExtension: { group: 'CTRIP', WebpSupport: false },
                },
            }),
        });
    } catch (err) {
        throw new CliError(
            'FETCH_ERROR',
            `ctrip suggest fetch failed: ${err instanceof Error ? err.message : String(err)}`,
            'Check your network connection and retry',
        );
    }
    if (!response.ok) {
        throw new CliError(
            'FETCH_ERROR',
            `ctrip suggest failed with status ${response.status}`,
            'Retry the command or verify ctrip.com is reachable',
        );
    }
    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        throw new CliError(
            'COMMAND_EXEC',
            `ctrip suggest returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
            'Ctrip may have changed the endpoint response format; retry later',
        );
    }
    if (payload && payload.Result === false) {
        const code = payload.ErrorCode ?? 'unknown';
        throw new CliError(
            'COMMAND_EXEC',
            `ctrip suggest API returned Result=false (ErrorCode=${code})`,
            'Verify keyword and retry; this typically means upstream rejected the query envelope',
        );
    }
    return Array.isArray(payload?.Response?.searchResults) ? payload.Response.searchResults : [];
}

/**
 * Pick the best lat/lon pair available.
 *
 * Domestic Mainland China rows ship `gdLat`/`gdLon` (gaode); international rows
 * ship `gLat`/`gLon` (google/wgs84). `lat`/`lon` is the legacy flat field — fall
 * through to it last. Zero values are treated as "missing" since the endpoint
 * uses 0.0 as a sentinel for unknown coords.
 */
export function pickCoords(item) {
    const candidates = [
        [item.gdLat, item.gdLon],
        [item.gLat, item.gLon],
        [item.lat, item.lon],
    ];
    for (const [la, lo] of candidates) {
        if (Number.isFinite(la) && Number.isFinite(lo) && (la !== 0 || lo !== 0)) {
            return { lat: la, lon: lo };
        }
    }
    return { lat: null, lon: null };
}

/**
 * Build a canonical user-facing URL from the suggest item type + ids.
 * Unknown types return null (do not silently fabricate URLs).
 */
export function buildUrl(item) {
    const id = item?.id ? String(item.id) : '';
    const cityId = item?.cityId ?? '';
    const cityName = item?.cityName ? String(item.cityName) : '';
    switch (item?.type) {
        case 'City':
            return cityId ? `https://you.ctrip.com/place/${encodeURIComponent(cityName)}${cityId}.html` : null;
        case 'Markland':
            return id && cityId
                ? `https://you.ctrip.com/sight/${encodeURIComponent(cityName)}${cityId}/${id}.html`
                : null;
        case 'Hotel':
            return id ? `https://hotels.ctrip.com/hotels/detail/?hotelid=${id}` : null;
        case 'BusinessArea':
        case 'Zone':
            return cityId && id
                ? `https://hotels.ctrip.com/hotels/list?city=${cityId}&zone=${id}`
                : null;
        case 'RailwayStation':
            return id ? `https://trains.ctrip.com/trainstation/${id}.html` : null;
        default:
            return null;
    }
}

function nz(v) {
    return Number.isFinite(v) && v !== 0 ? v : null;
}

function firstNonZero(...values) {
    for (const v of values) {
        const n = Number(v);
        if (Number.isFinite(n) && n !== 0) return n;
    }
    return null;
}

/**
 * Project a raw suggest row into the stable adapter column shape.
 * No silent fallbacks: every column has a deterministic value (string|number|null).
 */
export function mapSuggestRow(item, index) {
    const { lat, lon } = pickCoords(item);
    return {
        rank: index + 1,
        id: item?.id ? String(item.id) : null,
        type: item?.type ? String(item.type) : null,
        displayType: item?.displayType ? String(item.displayType).trim() : null,
        name: String(item?.displayName || item?.word || item?.cityName || '').replace(/\s+/g, ' ').trim() || null,
        eName: item?.eName ? String(item.eName).trim() : null,
        cityId: Number.isFinite(item?.cityId) && item.cityId !== 0 ? item.cityId : null,
        cityName: item?.cityName ? String(item.cityName).trim() : null,
        provinceName: item?.provinceName ? String(item.provinceName).trim() : null,
        countryName: item?.countryName ? String(item.countryName).trim() : null,
        lat,
        lon,
        score: firstNonZero(item?.commentScore, item?.cStar),
        url: buildUrl(item),
    };
}

export const __test__ = { ENDPOINT, MIN_LIMIT, MAX_LIMIT };
