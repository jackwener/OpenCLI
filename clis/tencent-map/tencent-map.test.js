import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    bd09ToGcj02, convertCoord, formatLatLng, gcj02ToWgs84, haversineMeters,
    normalizeCrs, outOfChina, parseLatLng, parseLatLngList, wgs84ToGcj02,
} from './coords.js';
import './search.js';
import './address.js';
import './locate.js';
import './convert.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

/** Reply with `body` when the request URL matches `match`, else fall through. */
function mockFetch(routes) {
    global.fetch = vi.fn((url) => {
        const target = String(url);
        for (const [match, body, status] of routes) {
            if (target.includes(match)) {
                return Promise.resolve(new Response(JSON.stringify(body), { status: status ?? 200 }));
            }
        }
        return Promise.resolve(new Response(JSON.stringify({ status: 999, message: `unmatched: ${target}` }), { status: 200 }));
    });
}

const SEARCH_PAYLOAD = {
    status: 0,
    message: 'Success',
    count: 2,
    data: [
        {
            id: '10015633769202902297',
            title: '腾讯滨海大厦',
            address: '广东省深圳市南山区海天二路33号',
            tel: '0755-1234',
            category: '房产小区:商务楼宇',
            location: { lat: 22.522807, lng: 113.935338 },
            ad_info: { adcode: '440305', province: '广东省', city: '深圳市', district: '南山区' },
        },
        {
            id: '507572764034027377',
            title: '腾讯滨海大厦-东门',
            address: '广东省深圳市南山区海天二路33号腾讯滨海大厦',
            tel: '',
            category: '室内及附属设施:通行设施类:外部门',
            location: { lat: 22.522812, lng: 113.935547 },
            ad_info: { adcode: '440305', province: '广东省', city: '深圳市', district: '南山区' },
        },
    ],
};

const SUGGESTION_PAYLOAD = {
    status: 0,
    message: 'query ok',
    count: 1,
    data: [{
        id: '10015633769202902297',
        title: '腾讯滨海大厦',
        address: '广东省深圳市南山区海天二路33号',
        category: '房产小区:商务楼宇',
        type: 0,
        location: { lat: 22.522807, lng: 113.935338 },
        adcode: 440305,
        province: '广东省',
        city: '深圳市',
        district: '南山区',
    }],
};

const FORWARD_PAYLOAD = {
    status: 0,
    message: 'Success',
    result: {
        title: '腾讯滨海大厦',
        location: { lng: 113.935338, lat: 22.522807 },
        ad_info: { adcode: '440305' },
        address_components: { province: '广东省', city: '深圳市', district: '南山区', street: '海天二路', street_number: '33' },
        similarity: 0.99,
        deviation: 1000,
        reliability: 7,
        level: 10,
    },
};

const REVERSE_PAYLOAD = {
    status: 0,
    message: 'Success',
    result: {
        location: { lat: 22.522807, lng: 113.935338 },
        address: '广东省深圳市南山区海天二路',
        poi_count: 10,
        pois: [{ id: '10015633769202902297', title: '腾讯滨海大厦', location: { lat: 22.522807, lng: 113.935338 } }],
        address_component: { nation: '中国', province: '广东省', city: '深圳市', district: '南山区', street: '海天二路', street_number: '' },
        ad_info: { adcode: '440305', phone_area_code: '0755' },
        formatted_addresses: { recommend: '南山区腾讯滨海大厦(海天二路西)', standard_address: '广东省深圳市南山区海天二路33号' },
    },
};

describe('tencent-map coordinate math', () => {
    // Cross-validated against Tencent's own ws/coord/v1/translate?type=1.
    it('matches Tencent GPS→GCJ-02 to 6 decimals', () => {
        const [lat, lng] = wgs84ToGcj02(22.523055, 113.935258);
        expect(lat).toBeCloseTo(22.520025, 6);
        expect(lng).toBeCloseTo(113.940125, 6);
    });

    it('round-trips GCJ-02 → WGS-84', () => {
        const [gLat, gLng] = wgs84ToGcj02(31.234567, 121.456789);
        const [wLat, wLng] = gcj02ToWgs84(gLat, gLng);
        expect(wLat).toBeCloseTo(31.234567, 8);
        expect(wLng).toBeCloseTo(121.456789, 8);
    });

    it('round-trips BD-09 → GCJ-02', () => {
        const [gLat, gLng] = wgs84ToGcj02(39.908823, 116.39747);
        const [bLat, bLng] = convertCoord(gLat, gLng, 'gcj02', 'bd09');
        const [backLat, backLng] = bd09ToGcj02(bLat, bLng);
        expect(backLat).toBeCloseTo(gLat, 6);
        expect(backLng).toBeCloseTo(gLng, 6);
    });

    it('treats the GCJ-02 warp as out of scope outside mainland China', () => {
        expect(outOfChina(35.68, 139.75)).toBe(true);
        expect(wgs84ToGcj02(35.68, 139.75)).toEqual([35.68, 139.75]);
        expect(haversineMeters(35.68, 139.75, 35.68, 139.75)).toBe(0);
    });

    it('reports a ~600 m shift for a Shenzhen GPS point', () => {
        const [lat, lng] = wgs84ToGcj02(22.523055, 113.935258);
        const shift = haversineMeters(22.523055, 113.935258, lat, lng);
        expect(shift).toBeGreaterThan(500);
        expect(shift).toBeLessThan(700);
    });

    it('resolves CRS aliases', () => {
        expect(normalizeCrs('GPS', '--from')).toBe('wgs84');
        expect(normalizeCrs('tencent', '--to')).toBe('gcj02');
        expect(normalizeCrs('baidu', '--to')).toBe('bd09');
        expect(() => normalizeCrs('mars', '--to')).toThrow(ArgumentError);
    });
});

describe('tencent-map coordinate parsing', () => {
    it('parses a lat,lng pair', () => {
        expect(parseLatLng('22.522807,113.935338')).toEqual({ lat: 22.522807, lng: 113.935338 });
    });

    it('rejects an lng,lat pair instead of reinterpreting it', () => {
        expect(() => parseLatLng('113.935338,22.522807')).toThrow(ArgumentError);
        expect(() => parseLatLng('113.935338,22.522807')).toThrow(/lat,lng/);
    });

    it('rejects a malformed pair and out-of-range latitudes', () => {
        expect(() => parseLatLng('22.5')).toThrow(ArgumentError);
        expect(() => parseLatLng('95,10')).toThrow(ArgumentError);
    });

    it('splits a batch on ; and newlines', () => {
        const points = parseLatLngList('22.5,113.9;31.2,121.4');
        expect(points).toHaveLength(2);
        expect(points[1]).toEqual({ lat: 31.2, lng: 121.4 });
    });

    it('formats with six decimals', () => {
        expect(formatLatLng(22.522807, 113.935338)).toBe('22.522807,113.935338');
    });
});

describe('tencent-map search', () => {
    const cmd = getRegistry().get('tencent-map/search');

    it('shapes rows from the regional endpoint', async () => {
        mockFetch([['/place/v1/search', SEARCH_PAYLOAD]]);
        const rows = await cmd.func({ keyword: '腾讯滨海大厦', region: '深圳市', limit: 10 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1,
            title: '腾讯滨海大厦',
            address: '广东省深圳市南山区海天二路33号',
            lat: 22.522807,
            lng: 113.935338,
            tel: '0755-1234',
            poi_id: '10015633769202902297',
            adcode: '440305',
            city: '深圳市',
            source: 'search',
        });
        expect(Object.keys(rows[0])).toEqual(cmd.columns);
    });

    it('falls back to the nationwide suggestion endpoint when --region is absent', async () => {
        mockFetch([['/place/v1/suggestion', SUGGESTION_PAYLOAD]]);
        const rows = await cmd.func({ keyword: '腾讯滨海大厦', limit: 10 });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ title: '腾讯滨海大厦', adcode: '440305', tel: null, source: 'suggestion' });
        expect(Object.keys(rows[0])).toEqual(cmd.columns);
    });

    it('raises EmptyResultError when nothing matches', async () => {
        mockFetch([['/place/v1/search', { status: 0, message: 'Success', count: 0, data: [] }]]);
        await expect(cmd.func({ keyword: '不存在', region: '深圳市', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects a limit above the ceiling instead of clamping it', async () => {
        await expect(cmd.func({ keyword: 'x', limit: 61 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects an empty keyword', async () => {
        await expect(cmd.func({ keyword: '  ', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects a region that would break the boundary DSL', async () => {
        await expect(cmd.func({ keyword: 'x', region: 'region(深圳市,0)', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
    });
});

describe('tencent-map address', () => {
    const cmd = getRegistry().get('tencent-map/address');

    it('shapes a forward geocode row', async () => {
        mockFetch([['/geocoder/v1/', FORWARD_PAYLOAD]]);
        const rows = await cmd.func({ address: '广东省深圳市南山区海天二路33号' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            query: '广东省深圳市南山区海天二路33号',
            title: '腾讯滨海大厦',
            address: '广东省深圳市南山区海天二路33号',
            lat: 22.522807,
            lng: 113.935338,
            adcode: '440305',
            similarity: 0.99,
            reliability: 7,
            deviation: 1000,
            verify_address: null,
        });
        expect(Object.keys(rows[0])).toEqual(cmd.columns);
    });

    it('folds --region into the queried text', async () => {
        mockFetch([['/geocoder/v1/', FORWARD_PAYLOAD]]);
        const rows = await cmd.func({ address: '海天二路33号', region: '深圳市' });
        expect(rows[0].query).toBe('深圳市海天二路33号');
    });

    it('does not duplicate a region already present in the address', async () => {
        mockFetch([['/geocoder/v1/', FORWARD_PAYLOAD]]);
        const rows = await cmd.func({ address: '深圳市南山区海天二路33号', region: '深圳市' });
        expect(rows[0].query).toBe('深圳市南山区海天二路33号');
    });

    it('reports an unparseable address as an argument error with the region hint', async () => {
        mockFetch([['/geocoder/v1/', { status: 348, message: '参数错误' }]]);
        await expect(cmd.func({ address: '天安门' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func({ address: '天安门' })).rejects.toMatchObject({
            hint: expect.stringContaining('--region'),
        });
    });

    it('--verify reverse-geocodes the resolved point', async () => {
        mockFetch([
            ['address=', FORWARD_PAYLOAD],
            ['location=', REVERSE_PAYLOAD],
        ]);
        const rows = await cmd.func({ address: '广东省深圳市南山区海天二路33号', verify: true });
        expect(rows[0].verify_address).toBe('广东省深圳市南山区海天二路33号');
    });
});

describe('tencent-map locate', () => {
    const cmd = getRegistry().get('tencent-map/locate');

    it('shapes a reverse geocode row', async () => {
        mockFetch([['/geocoder/v1/', REVERSE_PAYLOAD]]);
        const rows = await cmd.func({ location: '22.522807,113.935338' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            lat: 22.522807,
            lng: 113.935338,
            address: '广东省深圳市南山区海天二路',
            standard_address: '广东省深圳市南山区海天二路33号',
            nation: '中国',
            city: '深圳市',
            district: '南山区',
            adcode: '440305',
            phone_area_code: '0755',
            nearest_poi: '腾讯滨海大厦',
            poi_count: 10,
        });
        expect(Object.keys(rows[0])).toEqual(cmd.columns);
    });

    it('rejects an lng,lat input', async () => {
        await expect(cmd.func({ location: '113.935338,22.522807' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('raises EmptyResultError when the point has no address', async () => {
        mockFetch([['/geocoder/v1/', { status: 0, message: 'Success', result: { location: { lat: 0, lng: 0 } } }]]);
        await expect(cmd.func({ location: '0,0' })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('tencent-map convert', () => {
    const cmd = getRegistry().get('tencent-map/convert');

    it('defaults to WGS-84 → GCJ-02', async () => {
        const rows = await cmd.func({ coords: '22.523055,113.935258' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ input: '22.523055,113.935258', from: 'wgs84', to: 'gcj02', inside_china: true });
        expect(rows[0].lat).toBeCloseTo(22.520025, 6);
        expect(rows[0].lng).toBeCloseTo(113.940125, 6);
        expect(rows[0].shift_meters).toBeGreaterThan(500);
        expect(Object.keys(rows[0])).toEqual(cmd.columns);
    });

    it('handles a batch', async () => {
        const rows = await cmd.func({ coords: '22.523055,113.935258;39.908823,116.39747' });
        expect(rows).toHaveLength(2);
        expect(rows[1].input).toBe('39.908823,116.397470');
    });

    it('reports a no-op conversion outside mainland China honestly', async () => {
        const rows = await cmd.func({ coords: '35.680000,139.750000' });
        expect(rows[0]).toMatchObject({ shift_meters: 0, inside_china: false });
        expect(rows[0].lat).toBe(35.68);
    });

    it('rejects identical source and target systems', async () => {
        await expect(cmd.func({ coords: '22.5,113.9', from: 'gps', to: 'wgs84' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects an unknown CRS', async () => {
        await expect(cmd.func({ coords: '22.5,113.9', from: 'mars', to: 'gcj02' })).rejects.toBeInstanceOf(ArgumentError);
    });
});
