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

export const __test__ = { MIN_LIMIT, MAX_LIMIT };
