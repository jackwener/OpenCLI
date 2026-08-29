/**
 * 携程机票 oneway search — domestic + international flight search by route + date.
 *
 * Flight rows arrive in the page's natural `batchSearch` response. Capture that
 * response through CDP so Ctrip remains responsible for request parameters,
 * trace ids, risk controls, and session state; do not reconstruct its request.
 *
 * Round-trip search lives in the sibling `flight-round` command; advanced filters
 * (airline whitelist, cabin selection beyond 全舱位) remain out of scope here.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseIataCode, parseIsoDate, parseStrictIntegerRange } from './utils.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;
const CAPTURE_PATTERN = '/international/search/api/search/batchSearch';
const CAPTURE_TIMEOUT_SECONDS = 12;
const WAIT_FOR_BATCH_CAPTURE_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (location.pathname.includes('captcha') || /验证码|verify the human|安全验证/i.test(document.body?.innerText || '')) return 'captcha';
      if (document.querySelector('.flight-item')) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, ${CAPTURE_TIMEOUT_SECONDS * 1000});
  })
`;

function parseFlightLimit(raw) {
    return parseStrictIntegerRange('limit', raw, DEFAULT_LIMIT, MIN_LIMIT, MAX_LIMIT);
}

function cleanString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function timePart(value) {
    const match = cleanString(value).match(/(?:^|\s)([0-2]\d:[0-5]\d)(?::[0-5]\d)?$/);
    return match?.[1] || '';
}

function cabinLabel(value) {
    const labels = { Y: '经济舱', S: '超级经济舱', C: '公务舱', F: '头等舱' };
    const codes = [...new Set(cleanString(value).toUpperCase().match(/[YSCF]/g) || [])];
    return codes.length > 0 ? codes.map((code) => labels[code]).join('/') : (cleanString(value) || null);
}

function parseBatchSearchCaptures(entries) {
    if (!Array.isArray(entries)) {
        throw new CommandExecutionError('Ctrip flight network capture returned malformed entries');
    }
    const captured = entries.filter((entry) => String(entry?.url || '').includes(CAPTURE_PATTERN));
    if (captured.length === 0) return null;

    const byId = new Map();
    let finished = false;
    for (const entry of captured) {
        const status = Number(entry?.responseStatus || 0);
        if (status === 401 || status === 403) {
            throw new AuthRequiredError('flights.ctrip.com', `Ctrip flight API returned HTTP ${status}; complete any verification in the browser and retry`);
        }
        if (status !== 200) {
            throw new CommandExecutionError(`Ctrip flight API returned HTTP ${status || 'unknown'}`);
        }
        if (entry?.responseBodyTruncated === true) {
            throw new CommandExecutionError('Ctrip flight API response exceeded the browser capture limit');
        }
        if (typeof entry?.responsePreview !== 'string') {
            throw new CommandExecutionError('Ctrip flight API response body was unavailable');
        }
        let payload;
        try {
            payload = JSON.parse(entry.responsePreview);
        }
        catch {
            throw new CommandExecutionError('Ctrip flight API returned invalid JSON');
        }
        if (payload?.status !== 0) {
            throw new CommandExecutionError(`Ctrip flight API failed (status=${String(payload?.status)}): ${cleanString(payload?.msg) || 'unknown error'}`);
        }
        const itineraries = payload?.data?.flightItineraryList;
        if (!Array.isArray(itineraries) || typeof payload?.data?.context?.finished !== 'boolean') {
            throw new CommandExecutionError('Ctrip flight API returned a malformed batchSearch payload');
        }
        for (const itinerary of itineraries) {
            const id = cleanString(itinerary?.itineraryId);
            if (!id) throw new CommandExecutionError('Ctrip flight API returned an itinerary without an id');
            byId.set(id, itinerary);
        }
        finished = payload.data.context.finished;
    }
    if (!finished) {
        throw new CommandExecutionError('Ctrip flight batchSearch ended before the upstream search reported completion');
    }
    return [...byId.values()];
}

function mapItinerary(itinerary, searchUrl, index) {
    const segments = itinerary?.flightSegments;
    const prices = itinerary?.priceList;
    if (!Array.isArray(segments) || segments.length === 0 || !Array.isArray(prices) || prices.length === 0) {
        throw new CommandExecutionError(`Ctrip flight API returned malformed itinerary at index ${index}`);
    }
    const legs = segments.flatMap((segment) => Array.isArray(segment?.flightList) ? segment.flightList : []);
    const first = legs[0];
    const last = legs.at(-1);
    const airline = [...new Set(segments.map((segment) => cleanString(segment?.airlineName)).filter(Boolean))].join(' / ');
    const flightNo = [...new Set(legs.map((leg) => cleanString(leg?.flightNo)).filter(Boolean))].join(' / ');
    const aircraft = [...new Set(legs.map((leg) => cleanString(leg?.aircraftName)).filter(Boolean))].join(' / ') || null;
    const departureTime = timePart(first?.departureDateTime);
    const arrivalTime = timePart(last?.arrivalDateTime);
    const departureAirport = cleanString(first?.departureAirportName);
    const arrivalAirport = cleanString(last?.arrivalAirportName);
    const price = Number(prices[0]?.sortPrice ?? prices[0]?.adultPrice);
    if (!airline || !flightNo || !departureTime || !arrivalTime || !departureAirport || !arrivalAirport || !Number.isFinite(price)) {
        throw new CommandExecutionError(`Ctrip flight API returned malformed itinerary at index ${index}`);
    }
    const row = {
        airline,
        flightNo,
        aircraft,
        departureTime,
        departureAirport,
        arrivalTime,
        arrivalAirport,
        terminal: cleanString(last?.arrivalTerminal) || null,
        price,
        currency: '¥',
        cabin: cabinLabel(prices[0]?.cabin),
        url: searchUrl,
    };
    const isConnecting = legs.length > 1 || segments.some((segment) => Number(segment?.transferCount || 0) > 0);
    return [row, isConnecting, cleanString(first?.departureDateTime), cleanString(itinerary.itineraryId)];
}

cli({
    site: 'ctrip',
    name: 'flight',
    access: 'read',
    description: '搜索携程一程机票（按出发/到达 IATA 三字码 + 日期）',
    domain: 'flights.ctrip.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'from', required: true, positional: true, help: 'Departure IATA code (e.g. BJS / PEK)' },
        { name: 'to', required: true, positional: true, help: 'Arrival IATA code (e.g. SHA / PVG)' },
        { name: 'date', required: true, help: 'Departure date (YYYY-MM-DD)' },
        { name: 'limit', default: DEFAULT_LIMIT, help: `Number of flights (${MIN_LIMIT}-${MAX_LIMIT})` },
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
        if (typeof page?.startNetworkCapture !== 'function' ||
            typeof page?.readNetworkCapture !== 'function' ||
            !await page.startNetworkCapture(CAPTURE_PATTERN)) {
            throw new CommandExecutionError('Ctrip flight requires browser response interception');
        }
        await page.readNetworkCapture();
        await page.goto(searchUrl);
        // The initial document can finish before the large batchSearch body.
        // The first rendered card is only a readiness signal; row data still
        // comes exclusively from the structured response below.
        const readiness = await page.evaluate(WAIT_FOR_BATCH_CAPTURE_JS);
        if (readiness === 'captcha') {
            throw new AuthRequiredError('flights.ctrip.com', 'Ctrip is asking for a captcha; complete it in your browser session and retry');
        }
        const itineraries = parseBatchSearchCaptures(await page.readNetworkCapture());
        if (!itineraries) {
            throw new TimeoutError('Ctrip flight API capture', CAPTURE_TIMEOUT_SECONDS, 'No batchSearch response was observed after opening the results page.');
        }
        if (itineraries.length === 0) {
            throw new EmptyResultError('ctrip flight', `No flights for ${fromCode}→${toCode} on ${date}`);
        }
        const rows = itineraries
            .map((itinerary, index) => mapItinerary(itinerary, searchUrl, index))
            // The page groups direct flights before transfers, then applies its
            // displayed starting price and departure-time order inside each group.
            .sort(([rowA, connectingA, departureA, idA], [rowB, connectingB, departureB, idB]) =>
                Number(connectingA) - Number(connectingB) || rowA.price - rowB.price ||
                departureA.localeCompare(departureB) || idA.localeCompare(idB))
            .slice(0, limit)
            .map(([row], index) => ({
                rank: index + 1,
                airline: row.airline,
                flightNo: row.flightNo,
                aircraft: row.aircraft,
                departureTime: row.departureTime,
                departureAirport: row.departureAirport,
                arrivalTime: row.arrivalTime,
                arrivalAirport: row.arrivalAirport,
                terminal: row.terminal,
                price: row.price,
                currency: row.currency,
                cabin: row.cabin,
                url: row.url,
            }));
        return rows;
    },
});

export const __test__ = { parseFlightLimit };
