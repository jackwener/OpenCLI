/**
 * 12306 ticket price lookup for a single train + segment.
 *
 * Cascades three anonymous API calls:
 *   1. /otn/leftTicket/init: mint session cookies
 *   2. /otn/czxx/queryByTrainNo: resolve from/to station_no within the
 *      train route (price endpoint addresses stops by station_no, not
 *      telecode)
 *   3. /otn/leftTicket/queryTicketPrice: ticket prices keyed by seat
 *      letter (M=一等座, O=二等座, A9=商务座, A1=硬座, A3=硬卧,
 *      A4=软卧, F=动卧, P=特等座, WZ=无座, etc.)
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchStationBundle, mintSession, resolveStation, validateDate } from './utils.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0 Safari/537.36';
const TRAIN_NO_RE = /^[0-9A-Z]{8,18}$/;
const SEAT_TYPES_RE = /^[A-Z0-9]{1,32}$/;

const SEAT_LETTERS = {
    'A9': '商务座',
    'P': '特等座',
    'M': '一等座',
    'O': '二等座',
    'A1': '硬座',
    'A3': '硬卧',
    'A4': '软卧',
    'F': '动卧',
    'WZ': '无座',
};

async function queryStopsForPrice(cookieHeader, trainNo, fromCode, toCode, date, fetchImpl = fetch) {
    const url = `https://kyfw.12306.cn/otn/czxx/queryByTrainNo?train_no=${trainNo}&from_station_telecode=${fromCode}&to_station_telecode=${toCode}&depart_date=${date}`;
    const resp = await fetchImpl(url, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init',
            'Cookie': cookieHeader,
        },
    });
    if (!resp.ok) throw new CommandExecutionError(`12306 queryByTrainNo returned HTTP ${resp.status}`);
    let json;
    try {
        json = await resp.json();
    } catch {
        throw new CommandExecutionError('12306 queryByTrainNo returned non-JSON body');
    }
    if (json?.status !== true || !Array.isArray(json?.data?.data)) {
        throw new CommandExecutionError('12306 queryByTrainNo returned an unexpected payload shape');
    }
    return json.data.data;
}

function pickStationNos(stops, fromCode, toCode, fromName, toName) {
    const matches = (s, code, name) => (s.station_name && name && s.station_name === name);
    const fromStop = stops.find((s) => matches(s, fromCode, fromName));
    const toStop = stops.find((s) => matches(s, toCode, toName));
    if (!fromStop) throw new CommandExecutionError(`Train does not stop at ${fromName}`);
    if (!toStop) throw new CommandExecutionError(`Train does not stop at ${toName}`);
    return { fromNo: fromStop.station_no, toNo: toStop.station_no };
}

async function queryPrice(cookieHeader, trainNo, fromNo, toNo, seatTypes, date, fetchImpl = fetch) {
    const url = `https://kyfw.12306.cn/otn/leftTicket/queryTicketPrice?train_no=${trainNo}&from_station_no=${fromNo}&to_station_no=${toNo}&seat_types=${seatTypes}&train_date=${date}`;
    const resp = await fetchImpl(url, {
        headers: {
            'User-Agent': UA,
            'Referer': 'https://kyfw.12306.cn/otn/leftTicket/init',
            'Cookie': cookieHeader,
        },
    });
    if (!resp.ok) throw new CommandExecutionError(`12306 queryTicketPrice returned HTTP ${resp.status}`);
    let json;
    try {
        json = await resp.json();
    } catch {
        throw new CommandExecutionError('12306 queryTicketPrice returned non-JSON body');
    }
    if (json?.status !== true || !json?.data) {
        throw new CommandExecutionError('12306 queryTicketPrice returned an unexpected payload shape');
    }
    return json.data;
}

function parsePriceData(priceData) {
    const rows = [];
    for (const [letter, value] of Object.entries(priceData)) {
        if (letter === 'train_no' || letter === 'OT') continue;
        if (typeof value !== 'string' || !value) continue;
        // 12306 doubles up some prices as bare numerics ("9": "21580"), which
        // mirror their letter sibling ("A9": "¥2158.0") in cents/no-decimal
        // form. Skip the bare numeric letter codes to avoid duplicates.
        if (/^\d+$/.test(letter)) continue;
        if (!/^[A-Z]/.test(letter)) continue;
        const numeric = value.replace(/^¥/, '');
        if (!/^[\d.]+$/.test(numeric)) continue;
        rows.push({
            seat_code: letter,
            seat_name: SEAT_LETTERS[letter] || letter,
            price: numeric,
            currency: 'CNY',
        });
    }
    rows.sort((a, b) => Number(b.price) - Number(a.price));
    return rows;
}

cli({
    site: '12306',
    name: 'price',
    access: 'read',
    description: 'Look up 12306 ticket prices by seat class for one train on a given date and segment (anonymous, no login required)',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'train-no', positional: true, required: true, help: 'Internal train_no from `12306 trains` (e.g. 24000000G10L)' },
        { name: 'from', required: true, help: 'Origin station (Chinese name, telecode, or pinyin) - must be a stop of this train' },
        { name: 'to', required: true, help: 'Destination station - must be a stop of this train' },
        { name: 'date', required: true, help: 'Departure date in YYYY-MM-DD' },
        { name: 'seat-types', default: 'OM9PA1A3A4FWZ', help: 'Seat-type letters to query (default covers the common classes). Examples: OM9 (二等/一等/商务), A1A3A4 (硬座/硬卧/软卧).' },
    ],
    columns: ['seat_code', 'seat_name', 'price', 'currency'],
    func: async (kwargs) => {
        const trainNo = String(kwargs['train-no'] ?? '').trim();
        if (!trainNo) throw new ArgumentError('<train-no> must not be empty');
        if (!TRAIN_NO_RE.test(trainNo)) {
            throw new ArgumentError(
                `<train-no> "${trainNo}" does not look like a 12306 internal train_no`,
                'Use the train_no field from `12306 trains` output (e.g. 24000000G10L), not the public code (G1).',
            );
        }
        const fromArg = String(kwargs.from ?? '').trim();
        const toArg = String(kwargs.to ?? '').trim();
        if (!fromArg) throw new ArgumentError('--from station must not be empty');
        if (!toArg) throw new ArgumentError('--to station must not be empty');
        const date = validateDate(kwargs.date);
        const seatTypes = String(kwargs['seat-types'] ?? '').trim() || 'OM9PA1A3A4FWZ';
        if (!SEAT_TYPES_RE.test(seatTypes)) {
            throw new ArgumentError('--seat-types must contain only 12306 seat letters/digits (A-Z, 0-9)');
        }

        const stations = await fetchStationBundle();
        const fromStation = resolveStation(stations, fromArg);
        const toStation = resolveStation(stations, toArg);
        if (fromStation.code === toStation.code) {
            throw new ArgumentError(`--from and --to must differ; both resolved to ${fromStation.name} (${fromStation.code})`);
        }

        const cookieHeader = await mintSession();
        const stops = await queryStopsForPrice(cookieHeader, trainNo, fromStation.code, toStation.code, date);
        const { fromNo, toNo } = pickStationNos(stops, fromStation.code, toStation.code, fromStation.name, toStation.name);
        const priceData = await queryPrice(cookieHeader, trainNo, fromNo, toNo, seatTypes, date);
        const rows = parsePriceData(priceData);
        if (rows.length === 0) {
            throw new EmptyResultError(
                `No prices returned for train_no=${trainNo} ${fromStation.name} -> ${toStation.name} on ${date}`,
                'Try a different seat-types letter set, or check that this train operates on the date.',
            );
        }
        return rows;
    },
});

export const __test__ = { parsePriceData, pickStationNos, queryStopsForPrice, queryPrice, SEAT_LETTERS };
