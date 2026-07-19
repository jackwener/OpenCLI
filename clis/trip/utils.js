/**
 * Shared helpers for the Trip.com (international) adapter.
 *
 * Trip.com is the English-facing sibling of Ctrip; its search pages render
 * results client-side, so the browser-mode commands read the rendered DOM.
 * Flight rows are `.result-item` cards keyed by stable `data-testid` anchors
 * (`flights-name`, `stopInfoText`, `flight_price_*`).
 */
import { ArgumentError } from '@jackwener/opencli/errors';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseIataCode(name, raw) {
    if (raw === undefined || raw === null || raw === '') {
        throw new ArgumentError(`--${name} is required (3-letter IATA code, e.g. LON, NYC)`);
    }
    const value = String(raw).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(value)) {
        throw new ArgumentError(`--${name} must be a 3-letter IATA code, got ${JSON.stringify(raw)}`);
    }
    return value;
}

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

export function parseFlightLimit(raw, fallback = 20) {
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

export function buildFlightSearchUrl(fromCode, toCode, date) {
    const params = new URLSearchParams({
        dcity: fromCode.toLowerCase(),
        acity: toCode.toLowerCase(),
        ddate: date,
        triptype: 'ow',
        class: 'y',
        quantity: '1',
        locale: 'en_US',
        curr: 'USD',
    });
    return `https://www.trip.com/flights/showfarefirst?${params.toString()}`;
}

/**
 * Browser-context IIFE that extracts flight rows from Trip.com's rendered
 * `.result-item` cards. Fields are read from stable `data-testid` anchors plus
 * the `HH:MM` / `AM-PM` / `IATA` leaf-node pattern. Cards missing the airline,
 * both airports, or both times are dropped rather than surfaced with blanks.
 */
export function buildFlightExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const rows = [];
        document.querySelectorAll('.result-item').forEach((card) => {
          const airline = clean(card.querySelector('[data-testid="flights-name"]'));
          const codes = Array.from(card.querySelectorAll('[class*="font-black"]'))
            .map((el) => clean(el)).filter((t) => /^[A-Z]{3}$/.test(t));
          const leaves = Array.from(card.querySelectorAll('*'))
            .filter((el) => !el.children.length).map((el) => clean(el));
          const times = leaves.filter((t) => /^\\d{1,2}:\\d{2}$/.test(t));
          const meridiems = leaves.filter((t) => /^(AM|PM)$/.test(t));
          const duration = leaves.find((t) => /^\\d+h(\\s\\d+m)?$/.test(t)) || null;
          if (!airline || codes.length < 2 || times.length < 2) return;
          const withMeridiem = (i) => times[i] + (meridiems[i] ? ' ' + meridiems[i] : '');
          const priceEl = card.querySelector('[data-testid^="flight_price"]');
          const priceText = clean(priceEl);
          const priceNum = priceText.replace(/[^0-9.]/g, '');
          rows.push({
            airline,
            departureTime: withMeridiem(0),
            departureAirport: codes[0],
            arrivalTime: withMeridiem(1),
            arrivalAirport: codes[1],
            duration,
            stops: clean(card.querySelector('[data-testid="stopInfoText"]')) || null,
            price: priceNum ? Number(priceNum) : null,
            currency: priceText.startsWith('$') ? 'USD' : (priceText.replace(/[0-9.,\\s]/g, '') || null),
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the flight list to render, or detect a captcha / verification wall. */
export const WAIT_FOR_FLIGHTS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.result-item')) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 12000);
  })
`;

export function parseCityId(name, raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new ArgumentError(`--${name} is required (numeric Trip.com city id, e.g. 338 for London)`);
    }
    const value = String(raw).trim();
    if (!/^\d+$/.test(value)) {
        throw new ArgumentError(`--${name} must be a numeric Trip.com city id, got ${JSON.stringify(raw)}`);
    }
    return value;
}

export function buildHotelSearchUrl(cityId, checkin, checkout) {
    const params = new URLSearchParams({
        city: cityId,
        checkin,
        checkout,
        locale: 'en_US',
        curr: 'USD',
    });
    return `https://www.trip.com/hotels/list?${params.toString()}`;
}

/**
 * Browser-context IIFE that extracts hotel rows from Trip.com's rendered
 * `.hotel-card` cards, read by stable class-keyed fields
 * (`.hotelName/.score/.comment-num/.position-desc/.price-highlight`). Cards
 * without a hotel name are dropped rather than surfaced with blanks.
 */
export function buildHotelExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const toNum = (t) => { const m = String(t).replace(/[^0-9.]/g, ''); return m ? Number(m) : null; };
        const rows = [];
        document.querySelectorAll('.hotel-card').forEach((card) => {
          const name = clean(card.querySelector('.hotelName'));
          if (!name) return;
          const locations = Array.from(card.querySelectorAll('.position-desc'))
            .map((el) => clean(el)).filter(Boolean);
          const priceText = clean(card.querySelector('.price-highlight'));
          rows.push({
            name,
            score: toNum(clean(card.querySelector('.score'))),
            reviewLabel: clean(card.querySelector('.comment-desc')) || null,
            reviews: toNum(clean(card.querySelector('.comment-num'))),
            location: locations.join(', ') || null,
            room: clean(card.querySelector('.room-name')) || null,
            price: toNum(priceText),
            currency: priceText.startsWith('$') ? 'USD' : (priceText.replace(/[0-9.,\\s]/g, '') || null),
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the hotel list to render, or detect a verification wall. */
export const WAIT_FOR_HOTELS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.hotel-card')) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 12000);
  })
`;

export function parseHotelId(name, raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new ArgumentError(`--${name} is required (numeric Trip.com hotel id, discover via the hotels list)`);
    }
    const value = String(raw).trim();
    if (!/^\d+$/.test(value)) {
        throw new ArgumentError(`--${name} must be a numeric Trip.com hotel id, got ${JSON.stringify(raw)}`);
    }
    return value;
}

export function buildHotelDetailUrl(hotelId) {
    const params = new URLSearchParams({ hotelId, locale: 'en_US', curr: 'USD' });
    return `https://www.trip.com/hotels/detail/?${params.toString()}`;
}

/**
 * Browser-context IIFE that projects the single-hotel profile from
 * `__NEXT_DATA__.props.pageProps.hotelDetailResponse` (the same SSR shape the
 * mainland `ctrip hotel` detail uses). Rating sub-scores, popular amenities, and
 * the check-in/out policy are each joined into one string so the profile stays a
 * single flat row. Returns `null` when the SSR block is absent, so the caller
 * raises a typed error instead of surfacing blanks. Room-level nightly prices
 * load via a post-SSR XHR and are out of scope here.
 */
export function buildHotelDetailExtractJs() {
    return `
      (() => {
        const pp = window.__NEXT_DATA__?.props?.pageProps;
        const dr = pp && pp.hotelDetailResponse;
        if (!dr || typeof dr !== 'object') return null;
        const clean = (s) => (s == null ? null : String(s).replace(/\\s+/g, ' ').trim() || null);
        const num = (s) => { const n = Number(s); return Number.isFinite(n) && n !== 0 ? n : null; };
        const bi = dr.hotelBaseInfo || {};
        const nameInfo = bi.nameInfo || {};
        const starInfo = bi.starInfo || {};
        const pos = dr.hotelPositionInfo || {};
        const comment = (dr.hotelComment && dr.hotelComment.comment) || {};
        const scoreDetail = Array.isArray(comment.scoreDetail) ? comment.scoreDetail : [];
        const popList = (((dr.hotelFacilityPopV2 || {}).hotelPopularFacility || {}).list) || [];
        const cio = (dr.hotelPolicyInfo && dr.hotelPolicyInfo.checkInAndOut) || {};
        const cioContent = Array.isArray(cio.content) ? cio.content : [];
        return {
          hotelId: bi.masterHotelId != null ? String(bi.masterHotelId) : null,
          name: clean(nameInfo.name),
          enName: clean(nameInfo.nameEn),
          star: (Number.isFinite(starInfo.level) && starInfo.level > 0) ? starInfo.level : null,
          score: num(comment.score),
          scoreLabel: clean(comment.scoreDescription),
          reviewCount: (Number.isFinite(comment.totalComment) && comment.totalComment > 0) ? comment.totalComment : null,
          ratingBreakdown: scoreDetail.map((s) => (s && s.showName && s.showScore) ? clean(s.showName) + ' ' + clean(s.showScore) : null).filter(Boolean).join(' / ') || null,
          facilities: popList.map((f) => f && clean(f.facilityDesc)).filter(Boolean).join(' / ') || null,
          checkInOut: cioContent.map((c) => c && clean((c.title || '') + (c.description || ''))).filter(Boolean).join(' / ') || null,
          cityName: clean(bi.cityName),
          address: clean(pos.address),
          lat: num(pos.lat),
          lon: num(pos.lng),
        };
      })()
    `;
}

/** Wait for the hotel detail SSR block, or detect a verification wall. */
export const WAIT_FOR_HOTEL_DETAIL_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      const dr = window.__NEXT_DATA__?.props?.pageProps?.hotelDetailResponse;
      if (dr && dr.hotelBaseInfo && dr.hotelBaseInfo.nameInfo) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 12000);
  })
`;

export const __test__ = { MIN_LIMIT, MAX_LIMIT };
