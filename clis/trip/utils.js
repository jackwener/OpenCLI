/**
 * Shared helpers for the Trip.com (international) adapter.
 *
 * Trip.com is the English-facing sibling of Ctrip; its search pages render
 * results client-side, so the browser-mode commands read the rendered DOM.
 * Flight rows are `.result-item` cards keyed by stable `data-testid` anchors
 * (`flights-name`, `stopInfoText`, `flight_price_*`).
 */
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const POI_SEARCH_ENDPOINT = 'https://www.trip.com/restapi/soa2/14427/poiSearch';
const PACKAGE_SEARCH_ENDPOINT = 'https://www.trip.com/restapi/soa2/19866/FlightSelectSearch';

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

/**
 * Build the car-rental listing URL for a Trip.com carhire city. Trip.com files
 * these listings under an SEO path whose text slugs are cosmetic; only the
 * numeric city id in the trailing segment routes, so a placeholder country/city
 * slug is used and the id drives the page.
 */
export function buildCarListUrl(cityId) {
    return `https://www.trip.com/carhire/to-city-1/city-${cityId}/`;
}

/**
 * Browser-context IIFE that extracts car-rental rows from a Trip.com carhire
 * listing. Each `.card-item` carries the vehicle category and example model in
 * `.card-item-title`, the passenger count as the first number in
 * `.card-item-vehicle-info`, and the daily price in `.car-daily-price`. Cards
 * without a price or any name are dropped rather than surfaced with blanks.
 */
export function buildCarExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const txt = (el) => (el && (el.innerText || el.textContent)) || '';
        const rows = [];
        document.querySelectorAll('.card-item').forEach((card) => {
          const priceText = clean(card.querySelector('.car-daily-price'));
          const priceM = priceText.match(/\\$\\s?([\\d,]+(?:\\.\\d+)?)/);
          if (!priceM) return;
          const titleText = txt(card.querySelector('.card-item-title'));
          const vehicle = clean(card.querySelector('.title-info')) || null;
          const category = (vehicle ? titleText.replace(vehicle, '') : titleText).replace(/\\s+/g, ' ').trim() || null;
          if (!category && !vehicle) return;
          const seatsM = txt(card.querySelector('.card-item-vehicle-info')).match(/\\d+/);
          rows.push({
            category,
            vehicle,
            seats: seatsM ? Number(seatsM[0]) : null,
            price: Number(priceM[1].replace(/,/g, '')),
            currency: /\\$/.test(priceText) ? 'USD' : null,
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the car listing to render, or detect a verification wall. */
export const WAIT_FOR_CARS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.card-item .car-daily-price')) return 'content';
      if (/no results|no matching|couldn.t find|not available/i.test(document.body?.innerText || '')) return 'empty';
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
 * Build the airport-transfer listing URL. Trip.com files transfers under an SEO
 * path keyed on the city slug plus the airport IATA code
 * (`airport-transfers/<city>/airport-<iata>/`); a mismatched city bounces to the
 * landing page, so both are required and slugified here.
 */
export function buildTransferListUrl(city, airport) {
    const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `https://www.trip.com/airport-transfers/${slug(city)}/airport-${slug(airport)}/`;
}

/**
 * Browser-context IIFE that extracts airport-transfer rows from a Trip.com
 * transfer listing. Each `.vehicle-card` carries the vehicle type in
 * `.vehicle-card__title-text`, passenger and luggage capacity in
 * `.vehicle-card__capacity-text` / `.vehicle-card__luggage-text`, and the
 * from-price in `.vehicle-card__price-row` (the `$N off` promo sits in a
 * separate discount tag and is excluded). Cards without a type or price are
 * dropped rather than surfaced with blanks.
 */
export function buildTransferExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const intOf = (el) => { const m = clean(el).match(/\\d+/); return m ? Number(m[0]) : null; };
        const rows = [];
        document.querySelectorAll('.vehicle-card').forEach((card) => {
          const type = clean(card.querySelector('.vehicle-card__title-text'));
          const priceText = clean(card.querySelector('.vehicle-card__price-row'));
          const priceM = priceText.match(/\\$\\s?([\\d,]+(?:\\.\\d+)?)/);
          if (!type || !priceM) return;
          rows.push({
            type,
            passengers: intOf(card.querySelector('.vehicle-card__capacity-text')),
            luggage: intOf(card.querySelector('.vehicle-card__luggage-text')),
            price: Number(priceM[1].replace(/,/g, '')),
            currency: /\\$/.test(priceText) ? 'USD' : null,
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the transfer listing to render, or detect a verification wall. */
export const WAIT_FOR_TRANSFERS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.vehicle-card .vehicle-card__price-row')) return 'content';
      if (/no results|no matching|couldn.t find|not available/i.test(document.body?.innerText || '')) return 'empty';
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
 * Build the tour search URL. Trip.com files tour packages under
 * `package-tours/list?kwd=<keyword>` with a `tabType` selecting the product line
 * (`privateTours` / `groupTours`).
 */
export function buildTourSearchUrl(keyword, tourType) {
    const params = new URLSearchParams({ kwd: keyword, tabType: tourType, locale: 'en-US', curr: 'USD' });
    return `https://www.trip.com/package-tours/list?${params.toString()}`;
}

/**
 * Browser-context Promise that reads a tour search off the results page. The
 * product list is served by a signed POST that only fires on a search submit, so
 * rather than replaying the signed request this installs a fetch hook that
 * captures the response body carrying the `"products"` array, drives the page's
 * own search box (re-submitting the keyword) so the page issues its own signed
 * request, then resolves once the response lands. Returns `{ status, rows }`,
 * where `status` is `content` / `captcha` / `empty` / `noinput` / `timeout`
 * (`empty` when the results page reports `0 routes found` for a genuine no-match).
 */
export function buildTourSearchJs(keyword) {
    return `
      new Promise((resolve) => {
        const captured = [];
        const origFetch = window.fetch;
        window.fetch = function (url) {
          const promise = origFetch.apply(this, arguments);
          try {
            promise.then((res) => { res.clone().text().then((text) => {
              if (text.indexOf('"products":[') !== -1) {
                try { const data = JSON.parse(text); if (Array.isArray(data.products) && data.products.length) captured.push(data.products); } catch (e) {}
              }
            }).catch(() => {}); }).catch(() => {});
          } catch (e) {}
          return promise;
        };
        const input = document.querySelector('input[placeholder]') || document.querySelector('input');
        if (input) {
          const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          input.focus();
          setValue.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true }));
          setValue.call(input, ${JSON.stringify(keyword)}); input.dispatchEvent(new Event('input', { bubbles: true }));
          ['keydown', 'keyup'].forEach((type) => input.dispatchEvent(new KeyboardEvent(type, { bubbles: true, key: 'Enter', keyCode: 13 })));
        }
        const num = (v) => (typeof v === 'number' && isFinite(v)) ? v : null;
        let elapsed = 0;
        const timer = setInterval(() => {
          elapsed += 300;
          if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) { clearInterval(timer); window.fetch = origFetch; return resolve({ status: 'captcha' }); }
          if (captured.length) {
            clearInterval(timer); window.fetch = origFetch;
            const products = captured[captured.length - 1];
            const rows = products.map((p) => {
              const basic = p.basicInfo || {};
              const comment = (p.statistics && p.statistics.commentInfo) || {};
              return {
                name: basic.name || null,
                type: basic.productTypeName || null,
                rating: num(comment.score),
                reviews: num(comment.count),
                price: num(p.priceInfo && p.priceInfo.price),
                url: (basic.detailUrl && basic.detailUrl.ONLINE) || null,
              };
            });
            return resolve({ status: 'content', rows });
          }
          if (!input) { clearInterval(timer); window.fetch = origFetch; return resolve({ status: 'noinput' }); }
          if (!captured.length && elapsed >= 6000 && /0\\s+routes?\\s+found/i.test((document.body && document.body.innerText) || '')) { clearInterval(timer); window.fetch = origFetch; return resolve({ status: 'empty' }); }
          if (elapsed >= 16000) { clearInterval(timer); window.fetch = origFetch; return resolve({ status: 'timeout' }); }
        }, 300);
      })
    `;
}

/** Build the "Today's Top Deals" hub URL (English / USD). */
export function buildDealsUrl() {
    const params = new URLSearchParams({ locale: 'en-US', curr: 'USD' });
    return `https://www.trip.com/sale/deals/?${params.toString()}`;
}

/**
 * Browser-context IIFE that extracts running-promotion rows from Trip.com's
 * "Today's Top Deals" hub. Each promotion is an `.top-deals_link-item` tile whose
 * title sits in `.top-deals_item-tit`, offer line in `.top-deals_item-desc`, and
 * campaign page in the tile `href`; the `discount` is the percentage or `$N off`
 * parsed out of the title + offer text (`null` when the campaign states none).
 * The campaign `url` is normalised to its canonical path, dropping the per-session
 * promo tracking query. Tiles are deduped by that URL, and those without a title
 * or offer are dropped rather than surfaced with blanks.
 */
export function buildDealsExtractJs() {
    return `
      (() => {
        const clean = (el) => el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '';
        const rows = [];
        const seen = new Set();
        document.querySelectorAll('a[class*="top-deals_link-item"]').forEach((a) => {
          const raw = a.getAttribute('href') || '';
          if (!raw) return;
          const url = (raw.startsWith('http') ? raw : ('https://www.trip.com' + raw)).split('?')[0];
          if (seen.has(url)) return;
          const title = clean(a.querySelector('[class*="top-deals_item-tit"]'));
          const offer = clean(a.querySelector('[class*="top-deals_item-desc"]'));
          if (!title && !offer) return;
          seen.add(url);
          const discM = [title, offer].filter(Boolean).join(' ').match(/\\d+(?:\\.\\d+)?%|\\$\\s?\\d+(?:\\.\\d+)?\\s*off/i);
          rows.push({
            title: title || null,
            offer: offer || null,
            discount: discM ? discM[0].replace(/\\s+/g, ' ').trim() : null,
            url,
          });
        });
        return rows;
      })()
    `;
}

/** Wait for the deals hub to render, or detect a verification wall. */
export const WAIT_FOR_DEALS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (/captcha|verify you are human|security check/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('a[class*="top-deals_link-item"]')) return 'content';
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
 * Query Trip.com's public destination-suggest endpoint (the same POI search the
 * flight / hotel boxes call). It takes an unsigned JSON POST and returns city /
 * airport / place matches, so this needs no browser session. Returns the raw
 * `results` array. Missing/non-array `results` means schema drift; an explicit
 * empty array is the only valid empty-result shape.
 */
export async function fetchPoiSearch(keyword) {
    let response;
    try {
        response = await fetch(POI_SEARCH_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', currency: 'USD' },
            body: JSON.stringify({
                key: keyword,
                mode: '0',
                tripType: 'RT',
                Head: { Currency: 'USD', Locale: 'en-US', Source: 'ONLINE', Channel: 'EnglishSite', ClientID: 'opencli-trip' },
            }),
        });
    } catch (err) {
        throw new CommandExecutionError(`Trip.com poiSearch fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`Trip.com poiSearch failed with status ${response.status}`);
    }
    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        throw new CommandExecutionError(`Trip.com poiSearch returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(payload?.results)) {
        throw new CommandExecutionError('Trip.com poiSearch returned malformed payload: missing results array');
    }
    return payload.results;
}

/**
 * Flatten POI results into a flat suggestion list: each top-level city keeps its
 * own row, and its `childResults` (nearby airports) follow, so a single search
 * surfaces both the city id and the airport codes.
 */
export function flattenPoiResults(results) {
    const rows = [];
    for (const result of results) {
        if (!result || typeof result !== 'object') continue;
        rows.push(result);
        if (Array.isArray(result.childResults)) {
            for (const child of result.childResults) {
                if (child && typeof child === 'object') rows.push(child);
            }
        }
    }
    return rows;
}

/**
 * Project a POI suggestion into the stable adapter column shape. A row carrying
 * an airport code is an `airport` (feeds `flight` / `transfer`); otherwise it is a
 * `city` (feeds `hotel-search` / `car` / `tour`). Missing values stay `null`.
 */
export function mapSearchRow(item, index) {
    const airportCode = item?.airportCode ? String(item.airportCode).trim() : '';
    return {
        rank: index + 1,
        name: item?.name ? String(item.name).replace(/\s+/g, ' ').trim() : null,
        type: airportCode ? 'airport' : 'city',
        cityId: Number.isFinite(item?.cityId) && item.cityId !== 0 ? item.cityId : null,
        airportCode: airportCode || null,
        province: item?.provinceName ? String(item.provinceName).trim() : null,
        country: item?.countryName ? String(item.countryName).trim() : null,
    };
}

/**
 * Resolve a destination keyword to the Trip.com city its flight+hotel package
 * search needs: the metro `cityCode` (e.g. `SEL`) drives the flight leg and the
 * numeric `cityId` drives the hotel leg, both of which the public POI search
 * returns for a city match. Picks the first result carrying both (an airport
 * child only carries an `airportCode`), so one keyword resolves both endpoints.
 * Returns `null` when no city matches.
 */
export async function resolvePackageCity(keyword) {
    const results = await fetchPoiSearch(keyword);
    for (const item of results) {
        if (!item || typeof item !== 'object' || item.airportCode) continue;
        const cityCode = item.cityCode ? String(item.cityCode).trim().toUpperCase() : '';
        const cityId = Number.isFinite(item.cityId) && item.cityId !== 0 ? item.cityId : null;
        if (cityCode && cityId) {
            return { name: item.name ? String(item.name).replace(/\s+/g, ' ').trim() : keyword, cityCode, cityId };
        }
    }
    return null;
}

/**
 * Query Trip.com's flight+hotel package search (the flight-selection step of the
 * package booking flow). It takes an unsigned JSON POST keyed on the metro city
 * codes plus the destination hotel city id and returns the package's flight
 * options priced at the bundle rate, so this needs no browser session. `fmap` 19
 * is the flight+hotel product map and `sgrade` 4 economy; the return date rides on
 * the hotel checkout, so the flight criteria carries just the outbound segment,
 * the same shape the results page submits. Returns the raw `grouplist` array;
 * missing/non-array `grouplist` means schema drift, not "no packages".
 */
export async function fetchPackageSearch({ dcode, acode, hcityid, depart, ret, adults }) {
    const body = {
        head: {
            cid: '', ctok: '', cver: '1.0', lang: '01', sid: '8888', syscode: '09', auth: '', xsid: '',
            extension: [
                { name: 'locale', value: 'en-US' },
                { name: 'currency', value: 'USD' },
                { name: 'productLine', value: 'FlightHotel' },
                { name: 'source', value: 'ONLINE' },
            ],
            Locale: 'en-US', Language: 'en', Currency: 'USD', ClientID: '',
        },
        platform: { src: 'PC', lang: 'en-US', currency: 'USD', sitesrc: 'trip' },
        flightcriteria: {
            osource: 1, triptype: 1, fmap: 19, sflag: 0, rtype: 2,
            seglist: [{ segno: 1, ddate: depart, sgrade: 4, dcode, acode }],
            pinfo: { adults, children: 0, babys: 0 },
        },
        hotelcriteria: { chin: depart, chout: ret, hcityid, rnum: 1 },
    };
    let response;
    try {
        response = await fetch(PACKAGE_SEARCH_ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', currency: 'USD' },
            body: JSON.stringify(body),
        });
    } catch (err) {
        throw new CommandExecutionError(`Trip.com package search fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!response.ok) {
        throw new CommandExecutionError(`Trip.com package search failed with status ${response.status}`);
    }
    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        throw new CommandExecutionError(`Trip.com package search returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(payload?.grouplist)) {
        throw new CommandExecutionError('Trip.com package search returned malformed payload: missing grouplist array');
    }
    return payload.grouplist;
}

/**
 * Project a package flight group into the stable adapter column shape. A group's
 * `flightlist` is the itinerary legs (one for a nonstop), so the route summary
 * reads the departure off the first leg and the arrival off the last, with the
 * leg count minus one as the stop count. `price` is the per-person package
 * starting fare (`policylist[0].price.price`); missing values stay `null`.
 */
export function mapPackageRow(group, index) {
    const legs = Array.isArray(group?.flightlist) ? group.flightlist : [];
    const first = legs[0] || {};
    const last = legs[legs.length - 1] || {};
    const binfo = first.binfo || {};
    const price = group?.policylist?.[0]?.price?.price;
    const str = (v) => (v == null || v === '') ? null : String(v).replace(/\s+/g, ' ').trim();
    return {
        rank: index + 1,
        airline: str(binfo.airlineName),
        flightNo: str(binfo.flightno),
        from: str(first.dportinfo && first.dportinfo.aport),
        to: str(last.aportinfo && last.aportinfo.aport),
        departure: str(first.dateinfo && first.dateinfo.dtime),
        arrival: str(last.dateinfo && last.dateinfo.atime),
        stops: legs.length ? legs.length - 1 : null,
        price: (typeof price === 'number' && isFinite(price)) ? price : null,
        currency: 'USD',
    };
}

export const __test__ = { MIN_LIMIT, MAX_LIMIT, POI_SEARCH_ENDPOINT, PACKAGE_SEARCH_ENDPOINT };
