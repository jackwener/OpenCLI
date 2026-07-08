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

/* --------- Helpers shared by hotel-search / flight (browser-context) ---------- */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validate YYYY-MM-DD and return the canonical string. Rejects out-of-range
 * month/day, malformed input, and silent NaN. Does NOT coerce or shift timezones.
 */
export function parseIsoDate(name, raw) {
    if (raw === undefined || raw === null || raw === '') {
        throw new ArgumentError(`--${name} is required (YYYY-MM-DD)`);
    }
    const value = String(raw).trim();
    const m = ISO_DATE_RE.exec(value);
    if (!m) {
        throw new ArgumentError(`--${name} must be YYYY-MM-DD, got ${JSON.stringify(raw)}`);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new ArgumentError(`--${name} has invalid month/day: ${value}`);
    }
    // Cross-check via UTC date math so 2026-02-30 doesn't pass.
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
        throw new ArgumentError(`--${name} is not a real calendar date: ${value}`);
    }
    return value;
}

/**
 * Validate a 3-letter IATA airport / metro code, return uppercase.
 * Ctrip URL accepts both single-airport (PEK / PVG) and metro-group (BJS / SHA) codes.
 */
export function parseIataCode(name, raw) {
    if (raw === undefined || raw === null || raw === '') {
        throw new ArgumentError(`--${name} is required (3-letter IATA code, e.g. PEK, SHA)`);
    }
    const value = String(raw).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
        throw new ArgumentError(`--${name} must be a 3-letter IATA code, got ${JSON.stringify(raw)}`);
    }
    return value;
}

/**
 * Validate a numeric Ctrip city ID (returned by `ctrip search` / `ctrip hotel-suggest`).
 */
export function parseCityId(raw) {
    if (raw === undefined || raw === null || raw === '') {
        throw new ArgumentError('--city is required (numeric city ID from `ctrip search` or `ctrip hotel-suggest`)');
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        throw new ArgumentError(`--city must be a positive integer city ID, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

/**
 * Pick the best lat/lon from a Ctrip hotel `positionInfo.mapCoordinate` array.
 *
 * Each entry has a `coordinateType` (1=WGS84, 2=GCJ02, 3=BD09 / Baidu). We prefer
 * WGS84 when present (most portable), then fall through. All coordinates are
 * strings in the API, so we Number() and reject NaN.
 */
export function pickHotelMapCoords(mapCoordinate) {
    if (!Array.isArray(mapCoordinate) || mapCoordinate.length === 0) {
        return { lat: null, lon: null };
    }
    // Order: WGS84 (1) → GCJ02 (2) → BD09 (3) → whatever exists
    const ranking = (entry) => {
        const t = Number(entry?.coordinateType);
        if (t === 1) return 0;
        if (t === 2) return 1;
        if (t === 3) return 2;
        return 3;
    };
    const sorted = [...mapCoordinate].sort((a, b) => ranking(a) - ranking(b));
    for (const entry of sorted) {
        const lat = Number(entry?.latitude);
        const lon = Number(entry?.longitude);
        if (Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0)) {
            return { lat, lon };
        }
    }
    return { lat: null, lon: null };
}

/**
 * Project a single Ctrip hotel row from `__NEXT_DATA__.props.pageProps.initListData.hotelList[*]`
 * into stable adapter column shape.
 *
 * No silent fallbacks — every field is `string|number|null`, never `''` masquerading
 * as "no data" (see typed-errors.md §"scalar sentinels are anti-pattern").
 */
export function mapHotelRow(entry, index) {
    const hotelInfo = entry?.hotelInfo ?? {};
    const rooms = Array.isArray(entry?.roomInfo) ? entry.roomInfo : [];
    const summary = hotelInfo.summary ?? {};
    const nameInfo = hotelInfo.nameInfo ?? {};
    const hotelStar = hotelInfo.hotelStar ?? {};
    const commentInfo = hotelInfo.commentInfo ?? {};
    const positionInfo = hotelInfo.positionInfo ?? {};
    const firstRoom = rooms[0] ?? {};
    const priceInfo = firstRoom.priceInfo ?? {};

    const hotelId = summary.hotelId ? String(summary.hotelId) : null;
    const { lat, lon } = pickHotelMapCoords(positionInfo.mapCoordinate);

    // commenterNumber arrives as "13,966条点评" — strip non-digits to int, else null.
    let reviewCount = null;
    if (commentInfo.commenterNumber) {
        const digits = String(commentInfo.commenterNumber).replace(/[^\d]/g, '');
        if (digits) reviewCount = Number(digits);
    }
    const score = commentInfo.commentScore ? Number(commentInfo.commentScore) : null;

    const star = Number.isFinite(hotelStar.star) && hotelStar.star > 0 ? hotelStar.star : null;
    const price = Number.isFinite(priceInfo.price) && priceInfo.price > 0 ? priceInfo.price : null;

    return {
        rank: index + 1,
        hotelId,
        name: nameInfo.name ? String(nameInfo.name).trim() : null,
        enName: nameInfo.enName ? String(nameInfo.enName).trim() : null,
        star,
        score: Number.isFinite(score) && score > 0 ? score : null,
        scoreLabel: commentInfo.commentDescription ? String(commentInfo.commentDescription).trim() : null,
        reviewCount,
        cityName: positionInfo.cityName ? String(positionInfo.cityName).trim() : null,
        district: positionInfo.positionDesc ? String(positionInfo.positionDesc).trim() : null,
        address: positionInfo.address ? String(positionInfo.address).trim() : null,
        lat,
        lon,
        price,
        currency: priceInfo.currency ? String(priceInfo.currency).trim() : null,
        url: hotelId ? `https://hotels.ctrip.com/hotels/detail/?hotelid=${hotelId}` : null,
    };
}

/**
 * Build the browser-context IIFE that extracts flight rows from `.flight-list`.
 *
 * Flights are rendered as `.flight-list > span > div` cards. Each card's innerText
 * has a stable ordering (verified 2026-05-12 on bjs→sha route):
 *
 *   [airline, flightNo, aircraft, lowPriceTag?, depTime, depAirport,
 *    arrTime, arrAirport, terminal?, savings?, promo?, currency, price,
 *    priceSuffix, cabin, cta]
 *
 * `lowPriceTag` (e.g. "当日低价") + `terminal` (e.g. "T2") + `savings` + `promo`
 * are optional — we use position-of-first-time-match to anchor and parse around it.
 *
 * The host is baked in so `normalizeUrl` for booking links resolves on the calling site.
 */
export function buildFlightExtractJs() {
    return `
      (() => {
        const cleanText = (value) => (value || '').replace(/\\s+/g, ' ').trim();
        const isTime = (s) => /^([01]?\\d|2[0-3]):[0-5]\\d$/.test(s);
        const isCurrency = (s) => /^[¥$€£]$/.test(s);
        const isPriceDigits = (s) => /^\\d+([.,]\\d+)?$/.test(s);
        const isFlightNo = (s) => /^[A-Z0-9]{2}\\d{3,4}[A-Z]?$/.test(s);

        const rows = [];
        document.querySelectorAll('.flight-list > span > div').forEach((card) => {
          // Collect ordered text chunks (text nodes only, skip whitespace-only).
          const chunks = [];
          const walk = (node) => {
            for (const c of node.childNodes) {
              if (c.nodeType === 3) {
                const t = cleanText(c.textContent);
                if (t) chunks.push(t);
              } else if (c.nodeType === 1) {
                walk(c);
              }
            }
          };
          walk(card);
          if (chunks.length < 8) return;

          // Anchor on first HH:MM — that's depTime; depAirport is immediately after.
          const firstTimeIdx = chunks.findIndex(isTime);
          if (firstTimeIdx < 1) return;
          const airline = chunks[0];
          const flightNo = chunks[1] || null;
          if (!airline || !isFlightNo(flightNo)) return;
          const aircraft = chunks[2] && !isTime(chunks[2]) ? chunks[2] : null;

          const depTime = chunks[firstTimeIdx];
          const depAirport = chunks[firstTimeIdx + 1] || null;
          // Second HH:MM after depTime is arrTime
          const arrTimeIdx = chunks.findIndex((c, i) => i > firstTimeIdx && isTime(c));
          if (arrTimeIdx < 0) return;
          const arrTime = chunks[arrTimeIdx];
          const arrAirport = chunks[arrTimeIdx + 1] || null;
          if (!depAirport || !arrAirport) return;
          // Optional terminal chunk right after arrAirport (matches /^T\\d$/ or single letter)
          let terminal = null;
          if (arrTimeIdx + 2 < chunks.length && /^T\\d$/.test(chunks[arrTimeIdx + 2])) {
            terminal = chunks[arrTimeIdx + 2];
          }

          // Price: scan for currency symbol then a digit-only chunk
          let price = null;
          let currency = null;
          for (let i = 0; i < chunks.length - 1; i++) {
            if (isCurrency(chunks[i]) && isPriceDigits(chunks[i + 1])) {
              currency = chunks[i];
              price = Number(chunks[i + 1].replace(',', ''));
              break;
            }
          }
          // Cabin: scan from end for first non-CTA Chinese chunk ending in "舱"
          let cabin = null;
          for (let i = chunks.length - 1; i >= 0; i--) {
            if (/舱$/.test(chunks[i])) { cabin = chunks[i]; break; }
          }

          rows.push({
            airline,
            flightNo,
            aircraft,
            departureTime: depTime,
            departureAirport: depAirport,
            arrivalTime: arrTime,
            arrivalAirport: arrAirport,
            terminal,
            price,
            currency,
            cabin,
          });
        });
        return rows;
      })()
    `;
}

/**
 * Build a scroll-until-enough IIFE for flights/hotels DOM-card pagination.
 *
 * Mirrors `clis/xiaohongshu/search.js#buildScrollUntilJs` (PR #1487) — counts a
 * caller-supplied row selector, scrolls until count >= target / DOM plateau /
 * maxScrolls. Returns final row count so the caller can decide whether to
 * surface an EmptyResultError. (xiaohongshu's helper hardcodes
 * `section.note-item`; this generic version takes a selector.)
 */
export function buildScrollUntilJs(rowSelector, targetCount, maxScrolls = 8) {
    if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 100) {
        throw new ArgumentError(`targetCount must be an integer between 1 and 100, got ${JSON.stringify(targetCount)}`);
    }
    if (!Number.isInteger(maxScrolls) || maxScrolls < 1 || maxScrolls > 30) {
        throw new ArgumentError(`maxScrolls must be an integer between 1 and 30, got ${JSON.stringify(maxScrolls)}`);
    }
    return `
      (async () => {
        const sel = ${JSON.stringify(rowSelector)};
        const isVisible = (el) => {
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const countItems = () => Array.from(document.querySelectorAll(sel)).filter(isVisible).length;
        let lastCount = countItems();
        let plateauRounds = 0;
        for (let i = 0; i < ${maxScrolls}; i++) {
          if (countItems() >= ${targetCount}) break;
          const lastHeight = document.body.scrollHeight;
          window.scrollTo(0, lastHeight);
          await new Promise((resolve) => {
            let to;
            const ob = new MutationObserver(() => {
              if (document.body.scrollHeight > lastHeight) {
                clearTimeout(to);
                ob.disconnect();
                setTimeout(resolve, 200);
              }
            });
            ob.observe(document.body, { childList: true, subtree: true });
            to = setTimeout(() => { ob.disconnect(); resolve(null); }, 2500);
          });
          const newCount = countItems();
          if (newCount === lastCount) {
            plateauRounds++;
            if (plateauRounds >= 2) break;
          } else {
            plateauRounds = 0;
            lastCount = newCount;
          }
        }
        return countItems();
      })()
    `;
}

export const __test__ = { ENDPOINT, MIN_LIMIT, MAX_LIMIT };
