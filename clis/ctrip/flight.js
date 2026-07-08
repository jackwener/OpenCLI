/**
 * 携程机票 oneway search — domestic + international flight search by route + date.
 *
 * Unlike `hotel-search`, the flight rows are NOT in `__NEXT_DATA__` — they
 * arrive via a post-load XHR that the daemon network buffer currently can't
 * capture (see MEMORY `daemon_capture_pipeline_bug_2026_05_07`). We instead
 * extract from the rendered `.flight-list > span > div` cards using a
 * position-anchored innerText parser (see `buildFlightExtractJs` in utils).
 *
 * Round-trip + advanced filters (airline whitelist, cabin selection beyond
 * 全舱位) are out of scope for v1 — track in #1481 follow-up if requested.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildFlightExtractJs, buildScrollUntilJs, parseIataCode, parseIsoDate } from './utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

function parseFlightLimit(raw) {
    if (raw === undefined || raw === null || raw === '') return DEFAULT_LIMIT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

/**
 * Wait for `.flight-list > span > div` to render (the post-load XHR settles
 * 1-3s after navigation), or detect a captcha/login redirect.
 */
const WAIT_FOR_FLIGHTS_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.flight-list > span > div')) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 8000);
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
        const renderedCardCount = await page.evaluate(buildScrollUntilJs('.flight-list > span > div', limit));
        const raw = await page.evaluate(buildFlightExtractJs());
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
            .filter((r) => r.departureTime && r.departureAirport && r.arrivalTime && r.arrivalAirport && r.airline && r.flightNo)
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
