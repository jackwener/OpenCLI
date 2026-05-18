/**
 * 12306 train availability between two stations on a given date.
 *
 * Flow:
 *   1. Fetch the station bundle (cached implicitly via per-process module state).
 *   2. Mint anonymous session cookies via /otn/leftTicket/init.
 *   3. Query /otn/leftTicket/queryG; if 12306 returns
 *      `{c_url: "leftTicket/queryX"}` (endpoint rotation), retry once
 *      against the suggested name.
 *   4. Parse the `|`-separated train records.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchStationBundle, mintSession, resolveStation, validateDate, parseTrainRecord } from './utils.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';
const QUERY_ENDPOINTS = ['queryG', 'queryO', 'queryZ', 'queryA'];
const MAX_LIMIT = 100;

function normalizeLimit(value, defaultValue, max) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        throw new ArgumentError(`limit must be a positive integer (1-${max})`);
    }
    if (n > max) {
        throw new ArgumentError(`limit must be <= ${max}`);
    }
    return n;
}

async function queryLeftTickets(cookieHeader, fromCode, toCode, date) {
    const headers = {
        'User-Agent': UA,
        'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init',
        'Cookie': cookieHeader,
    };
    const queryParams = `leftTicketDTO.train_date=${date}&leftTicketDTO.from_station=${fromCode}&leftTicketDTO.to_station=${toCode}&purpose_codes=ADULT`;
    let lastResponseText = '';
    for (const endpoint of QUERY_ENDPOINTS) {
        const url = `https://kyfw.12306.cn/otn/leftTicket/${endpoint}?${queryParams}`;
        const resp = await fetch(url, { headers });
        if (!resp.ok) {
            if (resp.status === 302) continue;
            throw new CommandExecutionError(`12306 ${endpoint} returned HTTP ${resp.status}`);
        }
        const text = await resp.text();
        lastResponseText = text;
        let json;
        try { json = JSON.parse(text); } catch {
            throw new CommandExecutionError(`12306 ${endpoint} returned non-JSON body`);
        }
        if (json?.c_url && typeof json.c_url === 'string') {
            const rotated = json.c_url.replace('leftTicket/', '').trim();
            if (rotated && !QUERY_ENDPOINTS.includes(rotated)) {
                QUERY_ENDPOINTS.unshift(rotated);
            }
            continue;
        }
        if (Array.isArray(json?.data?.result)) {
            return json.data.result;
        }
        throw new CommandExecutionError(`12306 ${endpoint} returned an unexpected payload shape`);
    }
    throw new CommandExecutionError(`12306 rejected every known query endpoint name (${QUERY_ENDPOINTS.join(', ')}); the wire protocol may have changed. Last body: ${lastResponseText.slice(0, 200)}`);
}

cli({
    site: '12306',
    name: 'trains',
    access: 'read',
    description: 'List trains between two 12306 stations on a given date (anonymous, no login required)',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'from', positional: true, required: true, help: 'Origin station: Chinese name (北京), telecode (BJP), or pinyin (beijing)' },
        { name: 'to', positional: true, required: true, help: 'Destination station: same forms as <from>' },
        { name: 'date', required: true, help: 'Departure date in YYYY-MM-DD' },
        { name: 'limit', type: 'int', default: 50, help: `Maximum rows (1-${MAX_LIMIT})` },
    ],
    columns: [
        'code', 'from_station', 'to_station', 'start_time', 'arrive_time',
        'duration', 'available', 'business_seat', 'first_seat', 'second_seat',
        'soft_sleeper', 'hard_sleeper', 'hard_seat', 'no_seat', 'train_no',
    ],
    func: async (kwargs) => {
        const fromArg = String(kwargs.from ?? '').trim();
        const toArg = String(kwargs.to ?? '').trim();
        if (!fromArg) throw new ArgumentError('<from> station must not be empty');
        if (!toArg) throw new ArgumentError('<to> station must not be empty');
        const date = validateDate(kwargs.date);
        const limit = normalizeLimit(kwargs.limit, 50, MAX_LIMIT);

        const stations = await fetchStationBundle();
        const fromStation = resolveStation(stations, fromArg);
        const toStation = resolveStation(stations, toArg);
        if (fromStation.code === toStation.code) {
            throw new ArgumentError(`<from> and <to> must differ; both resolved to ${fromStation.name} (${fromStation.code})`);
        }
        const stationByCode = new Map(stations.map((s) => [s.code, s]));

        const cookieHeader = await mintSession();
        const rawRows = await queryLeftTickets(cookieHeader, fromStation.code, toStation.code, date);
        const decoded = rawRows
            .map((line) => parseTrainRecord(decodeURIComponent(line.replace(/%0A/g, '')), stationByCode))
            .filter(Boolean);

        if (decoded.length === 0) {
            throw new EmptyResultError(
                `No trains found from ${fromStation.name} to ${toStation.name} on ${date}`,
                'Try a different date or check whether the route is operated by 12306.',
            );
        }
        return decoded.slice(0, limit);
    },
});

export const __test__ = { normalizeLimit, queryLeftTickets };
