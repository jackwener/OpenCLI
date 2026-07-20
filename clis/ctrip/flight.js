/**
 * 携程机票 oneway search — domestic + international flight search by route + date.
 *
 * Unlike `hotel-search`, the flight rows are NOT in `__NEXT_DATA__` — they
 * arrive via a post-load XHR that the daemon network buffer currently can't
 * capture (see MEMORY `daemon_capture_pipeline_bug_2026_05_07`). We instead
 * extract from the rendered `.flight-item` cards, which Ctrip migrated the flight
 * list to and which omit a text flight number, using a position-anchored innerText
 * parser (see `buildFlightExtractJs` in utils).
 *
 * Round-trip search lives in the sibling `flight-round` command; advanced filters
 * (airline whitelist, cabin selection beyond 全舱位) remain out of scope here.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildFlightExtractJs, buildScrollUntilJs, parseIataCode, parseIsoDate, parseStrictIntegerRange } from './utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// Ctrip migrated the flight list to `.flight-item` cards (which omit a text flight
// number), so the command reads those with the flight-number requirement relaxed.
const FLIGHT_CARD_SELECTOR = '.flight-item';

function parseFlightLimit(raw) {
    return parseStrictIntegerRange('limit', raw, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
}

/**
 * Wait for the flight cards to finish rendering, or detect a captcha/login
 * redirect. The post-load XHR settles 1-3s after navigation and the cards fill in
 * progressively, so this polls the count of cards carrying a time + price and
 * resolves `content` only once that count has held steady, rather than firing on
 * the first card and under-reading the rest.
 */
const WAIT_FOR_FLIGHTS_JS = `
  new Promise((resolve) => {
    const isCaptcha = () => location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '');
    const fullCount = () => [...document.querySelectorAll('.flight-item')]
      .filter((el) => { const t = el.textContent || ''; return /\\d{1,2}:\\d{2}/.test(t) && /[¥$€£]/.test(t); }).length;
    let last = -1;
    let stable = 0;
    let elapsed = 0;
    const iv = setInterval(() => {
      elapsed += 400;
      if (isCaptcha()) { clearInterval(iv); return resolve('captcha'); }
      const c = fullCount();
      if (c > 0 && c === last) {
        if (++stable >= 2) { clearInterval(iv); return resolve('content'); }
      } else { last = c; stable = 0; }
      if (elapsed >= 18000) { clearInterval(iv); return resolve('timeout'); }
    }, 400);
  })
`;

cli({
    site: 'ctrip',
    name: 'flight',
    access: 'read',
    description: '搜索携程一程机票（按出发/到达 IATA 三字码 + 日期）',
    domain: 'flights.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure IATA code (e.g. BJS / PEK)' },
        { name: 'to', required: true, positional: true, help: 'Arrival IATA code (e.g. SHA / PVG)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of flights (${MIN_LIMIT}-${MAX_LIMIT})` },
    ],
    columns: [
        'rank',
        'airline', 'flightNo', 'aircraft',
        'departureTime', 'departureAirport',
        'arrivalTime', 'arrivalAirport', 'terminal',
        'price', 'currency', 'cabin',
        'url',
    ],
    func: async (page, kwargs) => {
        const fromCode = parseIataCode('from', kwargs.from);
        const toCode = parseIataCode('to', kwargs.to);
        if (fromCode === toCode) {
            throw new ArgumentError(`--from and --to must differ (got ${fromCode})`);
        }
        const date = parseIsoDate('date', kwargs.date);
        const limit = parseFlightLimit(kwargs.limit);

        const searchUrl =
            `https://flights.ctrip.com/online/list/oneway-${fromCode.toLowerCase()}-${toCode.toLowerCase()}` +
            `?depdate=${date}&cabin=Y_S_C_F&adult=1&child=0&infant=0`;
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_FLIGHTS_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('flights.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip flight page did not render flight cards (state=${String(waitResult)})`);
        }
        // Scroll until enough flight cards rendered (Ctrip lazy-loads beyond ~8).
        const renderedCardCount = await page.evaluate(buildScrollUntilJs(FLIGHT_CARD_SELECTOR, limit));
        const raw = await page.evaluate(buildFlightExtractJs(FLIGHT_CARD_SELECTOR, false));
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip flight DOM extraction returned malformed rows');
        }
        const rows = raw;
        if (rows.length === 0) {
            if (Number(renderedCardCount) > 0) {
                throw new CommandExecutionError('Ctrip flight cards rendered but parser did not find required flight anchors');
            }
            throw new EmptyResultError('ctrip flight', `No flights for ${fromCode}→${toCode} on ${date}`);
        }
        const completeRows = rows
            .filter((r) => r.departureTime && r.departureAirport && r.arrivalTime && r.arrivalAirport && r.airline)
            .slice(0, limit)
            .map((r, i) => ({
                rank: i + 1,
                airline: r.airline,
                flightNo: r.flightNo,
                aircraft: r.aircraft,
                departureTime: r.departureTime,
                departureAirport: r.departureAirport,
                arrivalTime: r.arrivalTime,
                arrivalAirport: r.arrivalAirport,
                terminal: r.terminal,
                price: r.price,
                currency: r.currency,
                cabin: r.cabin,
                url: searchUrl,
            }));
        if (completeRows.length === 0) {
            throw new CommandExecutionError('Ctrip flight rows were missing required airline/flight/time/airport anchors');
        }
        return completeRows;
    },
});

export const __test__ = { parseFlightLimit, WAIT_FOR_FLIGHTS_JS };
