import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './utils.js';
import { __test__ as priceTest } from './price.js';
import { __test__ as trainTest } from './train.js';
import './orders.js';

const { parseStationBundle, resolveStation, validateDate, buildCookieHeader, parseTrainRecord, maskEmail, maskMobile, maskChineseName, unwrapEvaluateResult, requireEvaluateObject, isAuthLikePayload } = __test__;
const { parsePriceData, queryStopsForPrice, queryPrice, TRAIN_NO_RE: PRICE_TRAIN_NO_RE } = priceTest;
const { queryStops, TRAIN_NO_RE: TRAIN_TRAIN_NO_RE } = trainTest;

describe('12306 utils - parseStationBundle', () => {
    it('parses the `@`-delimited station bundle into structured records', () => {
        const bundle = "var station_names ='@bjb|北京北|VAP|beijingbei|bjb|0|0357|北京|||@bji|北京|BJP|beijing|bj|2|0357|北京|||@aoh|上海虹桥|AOH|shanghaihongqiao|shhq|10|7600|上海|||';";
        const stations = parseStationBundle(bundle);
        expect(stations).toHaveLength(3);
        expect(stations[1]).toEqual({
            short: 'bji', name: '北京', code: 'BJP', pinyin: 'beijing', abbr: 'bj', city: '北京',
        });
    });

    it('skips records that lack a telecode', () => {
        const bundle = "var station_names ='@xxx|||||||||@bji|北京|BJP|beijing|bj|2|0357|北京|||';";
        const stations = parseStationBundle(bundle);
        expect(stations).toHaveLength(1);
        expect(stations[0].code).toBe('BJP');
    });

    it('throws CommandExecutionError when the bundle has no parseable station rows', () => {
        expect(() => parseStationBundle("var station_names ='@xxx|||||||||';")).toThrow(CommandExecutionError);
    });
});

describe('12306 utils - resolveStation', () => {
    const stations = [
        { short: 'bjb', name: '北京北', code: 'VAP', pinyin: 'beijingbei', abbr: 'bjb', city: '北京' },
        { short: 'bji', name: '北京', code: 'BJP', pinyin: 'beijing', abbr: 'bj', city: '北京' },
        { short: 'aoh', name: '上海虹桥', code: 'AOH', pinyin: 'shanghaihongqiao', abbr: 'shhq', city: '上海' },
    ];

    it('matches by exact Chinese name', () => {
        expect(resolveStation(stations, '上海虹桥').code).toBe('AOH');
    });

    it('matches by uppercase telecode', () => {
        expect(resolveStation(stations, 'BJP').code).toBe('BJP');
    });

    it('matches by full pinyin (case-insensitive)', () => {
        expect(resolveStation(stations, 'Beijing').code).toBe('BJP');
    });

    it('matches by short alias / abbr', () => {
        expect(resolveStation(stations, 'shhq').code).toBe('AOH');
    });

    it('throws ArgumentError for empty input', () => {
        expect(() => resolveStation(stations, '   ')).toThrow(ArgumentError);
    });

    it('throws ArgumentError for unknown station', () => {
        expect(() => resolveStation(stations, '某不存在站')).toThrow(ArgumentError);
    });

    it('throws ArgumentError for telecode-shaped but unknown input', () => {
        expect(() => resolveStation(stations, 'XYZ')).toThrow(ArgumentError);
    });
});

describe('12306 utils - validateDate', () => {
    it('accepts valid YYYY-MM-DD', () => {
        expect(validateDate('2026-05-22')).toBe('2026-05-22');
    });

    it('throws ArgumentError on wrong format', () => {
        expect(() => validateDate('2026/05/22')).toThrow(ArgumentError);
        expect(() => validateDate('26-05-22')).toThrow(ArgumentError);
        expect(() => validateDate('today')).toThrow(ArgumentError);
        expect(() => validateDate('')).toThrow(ArgumentError);
    });

    it('throws ArgumentError on impossible calendar dates', () => {
        expect(() => validateDate('2026-02-30')).toThrow(ArgumentError);
        expect(() => validateDate('2026-13-01')).toThrow(ArgumentError);
    });
});

describe('12306 utils - buildCookieHeader', () => {
    it('joins set-cookie lines into a single Cookie header', () => {
        const headers = [
            'JSESSIONID=ABC123; Path=/otn',
            'BIGipServerotn=xxx.yyy; Path=/',
            'route=zzz; Expires=Sat, 01 Jan 2027 00:00:00 GMT',
        ];
        expect(buildCookieHeader(headers)).toBe('JSESSIONID=ABC123; BIGipServerotn=xxx.yyy; route=zzz');
    });

    it('returns empty string for empty input', () => {
        expect(buildCookieHeader([])).toBe('');
        expect(buildCookieHeader(undefined)).toBe('');
    });
});

describe('12306 utils - parseTrainRecord', () => {
    const stationByCode = new Map([
        ['VNP', { name: '北京南', code: 'VNP' }],
        ['AOH', { name: '上海虹桥', code: 'AOH' }],
    ]);

    it('extracts the canonical train fields from a wire record', () => {
        // 33 `|`-separated fields, with positions used by parseTrainRecord populated.
        const fields = new Array(36).fill('');
        fields[0] = 'SECRET_TOKEN';
        fields[1] = '预订';
        fields[2] = '240000G54700';
        fields[3] = 'G547';
        fields[6] = 'VNP';
        fields[7] = 'AOH';
        fields[8] = '06:18';
        fields[9] = '12:11';
        fields[10] = '05:53';
        fields[11] = 'Y';
        fields[23] = ''; // soft sleeper
        fields[26] = '无'; // no seat
        fields[28] = ''; // hard sleeper
        fields[29] = ''; // hard seat
        fields[30] = '有'; // second seat
        fields[31] = '有'; // first seat
        fields[32] = '无'; // business seat
        const row = parseTrainRecord(fields.join('|'), stationByCode);
        expect(row).toEqual({
            train_no: '240000G54700',
            code: 'G547',
            from_station: '北京南',
            to_station: '上海虹桥',
            from_code: 'VNP',
            to_code: 'AOH',
            start_time: '06:18',
            arrive_time: '12:11',
            duration: '05:53',
            available: true,
            business_seat: '无',
            first_seat: '有',
            second_seat: '有',
            soft_sleeper: '',
            hard_sleeper: '',
            hard_seat: '',
            no_seat: '无',
        });
    });

    it('does not expose the booking-handshake secret token', () => {
        const fields = new Array(36).fill('');
        fields[0] = 'SECRET_TOKEN_DO_NOT_LEAK';
        fields[2] = 't_no'; fields[3] = 'X1'; fields[6] = 'VNP'; fields[7] = 'AOH';
        const row = parseTrainRecord(fields.join('|'), stationByCode);
        expect(Object.values(row)).not.toContain('SECRET_TOKEN_DO_NOT_LEAK');
        expect('secret' in row).toBe(false);
    });

    it('falls back to the telecode when the station bundle has no name', () => {
        const fields = new Array(36).fill('');
        fields[2] = 'X'; fields[3] = 'X'; fields[6] = 'ZZZ'; fields[7] = 'YYY';
        const row = parseTrainRecord(fields.join('|'), stationByCode);
        expect(row.from_station).toBe('ZZZ');
        expect(row.to_station).toBe('YYY');
    });

    it('returns null for short records', () => {
        expect(parseTrainRecord('a|b|c', stationByCode)).toBeNull();
    });
});

describe('12306 utils - mask helpers', () => {
    it('masks the local-part of an email', () => {
        expect(maskEmail('hello@example.com')).toBe('h***o@example.com');
        expect(maskEmail('ab@x.cn')).toBe('a*@x.cn');
        expect(maskEmail('a@x.cn')).toBe('a*@x.cn');
        expect(maskEmail('')).toBe('');
        expect(maskEmail('not-an-email')).toBe('not-an-email');
    });

    it('masks Chinese mobile numbers while preserving 12306-side masks', () => {
        expect(maskMobile('13800001234')).toBe('138****1234');
        expect(maskMobile('138****1234')).toBe('138****1234');
        expect(maskMobile('')).toBe('');
        expect(maskMobile('123')).toBe('**3');
    });

    it('masks Chinese real names', () => {
        expect(maskChineseName('张三')).toBe('张*');
        expect(maskChineseName('李四明')).toBe('李*明');
        expect(maskChineseName('欧阳锋')).toBe('欧*锋');
        expect(maskChineseName('张')).toBe('张');
        expect(maskChineseName('')).toBe('');
    });
});

describe('12306 price - parsePriceData', () => {
    it('returns seat rows sorted by descending price and drops dup numeric codes', () => {
        const data = {
            train_no: '24000000G10L',
            'OT': [],
            'A9': '¥2158.0',
            '9': '21580',
            'P': '¥1163.0',
            'M': '¥1035.0',
            'O': '¥626.0',
            'WZ': '¥626.0',
            'INVALID': 'not-a-price',
        };
        const rows = parsePriceData(data);
        const codes = rows.map((r) => r.seat_code);
        expect(codes).not.toContain('9');
        expect(codes).not.toContain('OT');
        expect(codes).not.toContain('train_no');
        expect(codes).not.toContain('INVALID');
        expect(codes).toEqual(['A9', 'P', 'M', 'O', 'WZ']);
        expect(rows[0]).toEqual({ seat_code: 'A9', seat_name: '商务座', price: '2158.0', currency: 'CNY' });
        expect(rows[4]).toEqual({ seat_code: 'WZ', seat_name: '无座', price: '626.0', currency: 'CNY' });
    });

    it('keeps unknown letter codes with the letter as the name', () => {
        const data = { 'A9': '¥100.0', 'ZZ': '¥50.0' };
        const rows = parsePriceData(data);
        const zz = rows.find((r) => r.seat_code === 'ZZ');
        expect(zz?.seat_name).toBe('ZZ');
    });
});

describe('12306 train_no validation regex', () => {
    // 12306 train_no values returned by /otn/leftTicket/query sometimes contain
    // lowercase letters (e.g. "5l000G1970A3" for G1970 上海虹桥 -> 宝鸡南).
    // Both `12306 price` and `12306 train` must accept the raw value emitted
    // by `12306 trains`, otherwise the two adapters drift apart and downstream
    // calls fail with ARGUMENT before ever hitting 12306.
    for (const [label, re] of [['price', PRICE_TRAIN_NO_RE], ['train', TRAIN_TRAIN_NO_RE]]) {
        describe(label, () => {
            it('accepts an all-uppercase train_no', () => {
                expect(re.test('24000000G10L')).toBe(true);
            });
            it('accepts a train_no with lowercase letters (real 12306 payload)', () => {
                expect(re.test('5l000G1970A3')).toBe(true);
            });
            it('rejects public codes like G1970', () => {
                expect(re.test('G1970')).toBe(false);
            });
            it('rejects values with disallowed characters', () => {
                expect(re.test('5l000-G1970A3')).toBe(false);
            });
        });
    }
});

describe('12306 public API typed boundaries', () => {
    const nonJsonFetch = async () => ({
        ok: true,
        json: async () => {
            throw new SyntaxError('Unexpected token <');
        },
    });

    it('wraps non-JSON train stop bodies as CommandExecutionError', async () => {
        await expect(queryStops('cookie=1', '24000000G10L', 'BJP', 'AOH', '2026-05-22', nonJsonFetch))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('wraps non-JSON price helper bodies as CommandExecutionError', async () => {
        await expect(queryStopsForPrice('cookie=1', '24000000G10L', 'BJP', 'AOH', '2026-05-22', nonJsonFetch))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(queryPrice('cookie=1', '24000000G10L', '01', '02', 'OM9', '2026-05-22', nonJsonFetch))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('12306 browser evaluate boundaries', () => {
    it('unwraps Browser Bridge {session,data} evaluate envelopes only at the boundary', () => {
        expect(unwrapEvaluateResult({ session: 's1', data: 'JSESSIONID=1; tk=2' })).toBe('JSESSIONID=1; tk=2');
        expect(unwrapEvaluateResult({ status: true, data: { value: 1 } })).toEqual({ status: true, data: { value: 1 } });
        expect(requireEvaluateObject({ session: 's1', data: { status: true } }, 'test')).toEqual({ status: true });
        expect(() => requireEvaluateObject({ session: 's1', data: null }, 'test')).toThrow(CommandExecutionError);
    });

    it('classifies 12306 login-like API envelopes as auth failures', () => {
        expect(isAuthLikePayload({ status: false, messages: ['用户未登录'] })).toBe(true);
        expect(isAuthLikePayload({ status: false, validateMessages: { global: ['请登录后再试'] } })).toBe(true);
        expect(isAuthLikePayload({ status: false, messages: ['系统繁忙'] })).toBe(false);
    });

    it('masks passenger names in orders by default and supports explicit sensitive opt-in', async () => {
        const command = getRegistry().get('12306/orders');
        const makePage = () => ({
            goto: async () => {},
            evaluate: async (script) => {
                if (script === "document.cookie || ''") return { session: 'browser', data: 'JSESSIONID=abc; tk=def' };
                return {
                    session: 'browser',
                    data: {
                        status: true,
                        data: {
                            orderDBList: [{
                                sequence_no: 'E123',
                                order_date: '2026-05-18 10:00',
                                train_code_page: 'G1',
                                from_station_name_page: '北京南',
                                to_station_name_page: '上海虹桥',
                                start_train_date_page: '2026-05-22 07:00',
                                ticket_status_name: '未出行',
                                ticket_total_price_page: '626.0',
                                tickets: [{ passenger_name: '张三' }, { passenger_name: '李四明' }],
                            }],
                        },
                    },
                };
            },
        });

        await expect(command.func(makePage(), {})).resolves.toMatchObject([
            { order_id: 'E123', passengers: '张*, 李*明' },
        ]);
        await expect(command.func(makePage(), { 'include-sensitive': true })).resolves.toMatchObject([
            { order_id: 'E123', passengers: '张三, 李四明' },
        ]);
    });

    it('maps login-like order payloads to AuthRequiredError instead of parser drift', async () => {
        const command = getRegistry().get('12306/orders');
        const page = {
            goto: async () => {},
            evaluate: async (script) => {
                if (script === "document.cookie || ''") return 'JSESSIONID=abc; tk=def';
                return { status: false, messages: ['用户未登录'] };
            },
        };

        await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('treats missing order list shape as parser drift but known empty arrays as empty result', async () => {
        const command = getRegistry().get('12306/orders');
        const makePage = (payload) => ({
            goto: async () => {},
            evaluate: async (script) => {
                if (script === "document.cookie || ''") return 'JSESSIONID=abc; tk=def';
                return payload;
            },
        });

        await expect(command.func(makePage({ status: true, data: {} }), {}))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ status: true, data: { orderDBList: [] } }), {}))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
