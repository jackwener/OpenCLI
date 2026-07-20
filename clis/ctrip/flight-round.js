/**
 * 携程机票 round-trip search — domestic + international round-trip by route + dates.
 *
 * The round-trip results deep-link to the same `flights.ctrip.com/online/list`
 * app as `flight`, under a `round-<from>-<to>?depdate=<depart>_<return>` URL that
 * renders the outbound (去程) leg priced for the whole round trip (往返总价). The
 * cards are `.flight-item` rows carrying the same ordered text shape as the
 * one-way list, so this reuses the position-anchored parser with that selector
 * (see `buildFlightExtractJs` in utils). The `price` is the round-trip total for
 * the outbound flight shown; picking the return leg is a second step out of scope.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildFlightExtractJs, parseIataCode, parseIsoDate, parseListLimit } from './utils.js';

const ROUND_CARD_SELECTOR = '.flight-item';

/**
 * Wait for `.flight-item` to render (the post-load XHR settles 1-3s after
 * navigation), or detect a captcha/login redirect.
 */
const WAIT_FOR_FLIGHTS_ROUND_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (location.pathname.includes('captcha') || /验证码|verify the human/i.test(document.body?.innerText || '')) return 'captcha';
      const items = document.querySelectorAll('.flight-item');
      if (items.length && [...items].some((el) => { const t = el.textContent || ''; return /\\d{1,2}:\\d{2}/.test(t) && /[¥$]/.test(t); })) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 18000);
  })
`;

cli({
    site: 'ctrip',
    name: 'flight-round',
    access: 'read',
    description: '搜索携程往返机票（按出发/到达 IATA 三字码 + 去/返日期，返回去程腿含往返总价）',
    domain: 'flights.ctrip.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure IATA code (e.g. BJS / PEK)' },
        { name: 'to', required: true, positional: true, help: 'Arrival IATA code (e.g. SHA / PVG)' },
        { name: 'depart', required: true, help: 'Outbound date (YYYY-MM-DD)' },
        { name: 'return', required: true, help: 'Return date (YYYY-MM-DD), on or after depart' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of flights (1-50)' },
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
        const depart = parseIsoDate('depart', kwargs.depart);
        const ret = parseIsoDate('return', kwargs.return);
        if (ret < depart) {
            throw new ArgumentError(`--return (${ret}) must be on or after --depart (${depart})`);
        }
        const limit = parseListLimit(kwargs.limit);

        const searchUrl =
            `https://flights.ctrip.com/online/list/round-${fromCode.toLowerCase()}-${toCode.toLowerCase()}` +
            `?depdate=${depart}_${ret}&cabin=Y_S_C_F&adult=1&child=0&infant=0`;
        await page.goto(searchUrl);
        const waitResult = await page.evaluate(WAIT_FOR_FLIGHTS_ROUND_JS);
        if (waitResult === 'captcha') {
            throw new AuthRequiredError('flights.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        if (waitResult !== 'content') {
            throw new CommandExecutionError(`Ctrip round-trip flight page did not render flight cards (state=${String(waitResult)})`);
        }
        const renderedCardCount = await page.evaluate(`document.querySelectorAll(${JSON.stringify(ROUND_CARD_SELECTOR)}).length`);
        const raw = await page.evaluate(buildFlightExtractJs(ROUND_CARD_SELECTOR, false));
        if (!Array.isArray(raw)) {
            throw new CommandExecutionError('Ctrip round-trip flight DOM extraction returned malformed rows');
        }
        if (raw.length === 0) {
            if (Number(renderedCardCount) > 0) {
                throw new CommandExecutionError('Ctrip round-trip flight cards rendered but parser did not find required flight anchors');
            }
            throw new EmptyResultError('ctrip flight-round', `No round-trip flights for ${fromCode}→${toCode} on ${depart} / ${ret}`);
        }
        const completeRows = raw
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
            throw new CommandExecutionError('Ctrip round-trip flight rows were missing required airline/flight/time/airport anchors');
        }
        return completeRows;
    },
});

export const __test__ = { WAIT_FOR_FLIGHTS_ROUND_JS, ROUND_CARD_SELECTOR };
