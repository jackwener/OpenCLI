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

export function parseListLimit(raw, fallback = 20) {
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

export function buildFlightRoundSearchUrl(fromCode, toCode, depart, ret) {
    const params = new URLSearchParams({
        dcity: fromCode.toLowerCase(),
        acity: toCode.toLowerCase(),
        ddate: depart,
        rdate: ret,
        triptype: 'rt',
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

export function parseKeyword(name, raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
        throw new ArgumentError(`--${name} is required (a destination or attraction keyword)`);
    }
    const value = String(raw).trim();
    if (value.length > 60) {
        throw new ArgumentError(`--${name} is too long (max 60 chars): ${JSON.stringify(raw)}`);
    }
    return value;
}

export function buildAttractionSearchUrl(keyword) {
    const params = new URLSearchParams({ keyword, locale: 'en_US', curr: 'USD' });
    return `https://www.trip.com/things-to-do/list?${params.toString()}`;
}

/**
 * Browser-context IIFE that extracts attraction / experience rows from Trip.com's
 * things-to-do results. The product cards use hashed CSS-module class names, so
 * this anchors on the one stable handle each card exposes, the
 * `things-to-do/detail/<id>` link (name is its text, `url` its href), and reads
 * rating / reviews / booked / price from the card's text by data-format pattern
 * rather than by hashed class. The price excludes the "$N off" promo tag and
 * takes the current (lowest non-promo) fare. Cards without a name or id are
 * dropped rather than surfaced with blanks.
 */
export function buildAttractionExtractJs() {
    return `
      (() => {
        const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const kNum = (s) => { if (!s) return null; const n = Number(String(s).replace(/k/i, '').replace(/,/g, '')); return /k/i.test(s) ? Math.round(n * 1000) : n; };
        const rows = [];
        const seen = new Set();
        document.querySelectorAll('a[href*="/things-to-do/detail/"]').forEach((link) => {
          const name = clean(link.textContent);
          if (!name || name.length < 4) return;
          const href = link.getAttribute('href') || '';
          const idMatch = href.match(/\\/detail\\/(\\d+)/);
          const id = idMatch ? idMatch[1] : null;
          if (!id || seen.has(id)) return;
          seen.add(id);
          let card = link;
          const txt = (el) => (el && (el.innerText || el.textContent)) || '';
          for (let i = 0; i < 6; i++) { if (card.parentElement) { card = card.parentElement; if (/\\$\\s?\\d/.test(txt(card))) break; } }
          const t = txt(card);
          const ratingM = t.match(/(\\d(?:\\.\\d)?)\\s*\\/\\s*5/);
          const reviewsM = t.match(/([\\d.]+k?)\\s+reviews/i);
          const bookedM = t.match(/([\\d.]+k?)\\s+booked/i);
          const prices = [];
          const re = /\\$\\s?([\\d,]+(?:\\.\\d+)?)/g;
          let m;
          while ((m = re.exec(t)) !== null) {
            if (!/off/i.test(t.slice(m.index, m.index + m[0].length + 5))) prices.push(Number(m[1].replace(/,/g, '')));
          }
          rows.push({
            name,
            rating: ratingM ? Number(ratingM[1]) : null,
            reviews: kNum(reviewsM && reviewsM[1]),
            booked: kNum(bookedM && bookedM[1]),
            price: prices.length ? Math.min.apply(null, prices) : null,
            url: href.startsWith('http') ? href : ('https://www.trip.com' + href),
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the attraction results to render (products lazy-load), or detect a verification wall. */
export const WAIT_FOR_ATTRACTIONS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelectorAll('a[href*="/things-to-do/detail/"]').length > 2 && /\\$\\s?\\d/.test(document.body?.innerText || '')) return 'content';
      if (/no results|no matching|couldn.t find/i.test(document.body?.innerText || '')) return 'empty';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 15000);
  })
`;

/**
 * Build the timetable URL for a train route. Trip.com organises route pages under
 * a country segment (`trains/<country>/route/<from>-to-<to>/`), so the country is
 * required; the city names are slugified.
 */
export function buildTrainRouteUrl(country, from, to) {
    const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `https://www.trip.com/trains/${slug(country)}/route/${slug(from)}-to-${slug(to)}/`;
}

/**
 * Browser-context IIFE that extracts train journeys from a Trip.com route
 * timetable. Rows are `<tr>` entries with a `.item-departure` / `.item-arrival`
 * cell (time in `.item-time-text`, station in `.item-name`); duration and change
 * count are parsed from the departure cell text after the time. The SEO
 * timetable carries no per-journey fare (it sits behind the "Find Tickets"
 * booking step). Rows without both times and stations are dropped.
 */
export function buildTrainExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const rows = [];
        document.querySelectorAll('tr').forEach((tr) => {
          const dep = tr.querySelector('.item-departure');
          const arr = tr.querySelector('.item-arrival');
          if (!dep || !arr) return;
          const departureTime = (clean(dep.querySelector('.item-time-text')).match(/\\d{1,2}:\\d{2}/) || [])[0] || '';
          const arrivalTime = (clean(arr.querySelector('.item-time-text')).match(/\\d{1,2}:\\d{2}/) || [])[0] || '';
          const fromStation = clean(dep.querySelector('.item-name'));
          const toStation = clean(arr.querySelector('.item-name'));
          if (!departureTime || !arrivalTime || !fromStation || !toStation) return;
          const rest = clean(dep).replace(departureTime, '');
          const durMatch = rest.match(/(\\d+\\s*h(?:\\s*\\d+\\s*m)?|\\d+\\s*min)/i);
          const changeMatch = rest.match(/(\\d+)\\s*changes?/i);
          rows.push({
            departureTime,
            fromStation,
            arrivalTime,
            toStation,
            duration: durMatch ? durMatch[1].replace(/\\s+/g, ' ').trim() : null,
            changes: changeMatch ? Number(changeMatch[1]) : (/direct|non-?stop/i.test(rest) ? 0 : null),
          });
        });
        return rows;
      })()
    `;
}

/** Wait for a train timetable to render, or detect a verification wall. */
export const WAIT_FOR_TRAINS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.item-departure .item-time-text')) return 'content';
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
