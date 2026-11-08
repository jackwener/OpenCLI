// tencent-map locate — reverse geocoding: a coordinate → what is actually there.
//
// This is the capability behind the getPoint page's "点图获取坐标" flow, and the
// natural verification for the other three commands: it answers "the point I
// got — is it where I think it is?".
//
// `nearest_poi` carries the closest named place the gateway matched, which is
// usually far more actionable than a raw administrative address.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { APPTAG, emptyResult, tmapRequest } from './utils.js';
import { formatLatLng, parseLatLng } from './coords.js';

const COLUMNS = [
    'lat', 'lng', 'address', 'standard_address', 'recommend_address',
    'nation', 'province', 'city', 'district', 'street', 'street_number',
    'adcode', 'phone_area_code', 'nearest_poi', 'poi_count',
];

function numberOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

cli({
    site: 'tencent-map',
    name: 'locate',
    access: 'read',
    description: '腾讯地图逆地址解析：坐标 → 具体地址 / 行政区划 / 最近 POI',
    domain: 'h5gw.map.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'location', type: 'string', required: true, positional: true, help: '坐标，纬度在前："lat,lng"，如 22.522807,113.935338' },
    ],
    columns: COLUMNS,
    func: async (args) => {
        // Tencent's `location` is latitude-first; parseLatLng rejects a swapped
        // pair with a hint rather than reinterpreting it.
        const { lat, lng } = parseLatLng(args.location, 'location');

        const body = await tmapRequest('/geocoder/v1/', {
            location: formatLatLng(lat, lng),
            get_poi: 1,
        }, 'tencent-map locate', { apptag: APPTAG.geocoder });

        const hit = body.result;
        if (!hit || typeof hit !== 'object') {
            throw emptyResult('tencent-map locate', `No address resolved for ${formatLatLng(lat, lng)}.`);
        }
        const parts = hit.address_component && typeof hit.address_component === 'object' ? hit.address_component : {};
        const info = hit.ad_info && typeof hit.ad_info === 'object' ? hit.ad_info : {};
        const formatted = hit.formatted_addresses && typeof hit.formatted_addresses === 'object' ? hit.formatted_addresses : {};
        const pois = Array.isArray(hit.pois) ? hit.pois : [];
        const nearest = pois[0] && typeof pois[0] === 'object' && typeof pois[0].title === 'string' ? pois[0].title : null;

        const resolved = hit.location && typeof hit.location === 'object' ? hit.location : {};
        const outLat = numberOrNull(resolved.lat);
        const outLng = numberOrNull(resolved.lng);

        if (!hit.address && !formatted.standard_address && !parts.city) {
            throw emptyResult('tencent-map locate', `Tencent returned no address for ${formatLatLng(lat, lng)} (open water / outside coverage?).`);
        }

        return [{
            lat: outLat === null ? lat : outLat,
            lng: outLng === null ? lng : outLng,
            address: hit.address || null,
            standard_address: formatted.standard_address || null,
            recommend_address: formatted.recommend || null,
            nation: parts.nation || null,
            province: parts.province || null,
            city: parts.city || null,
            district: parts.district || null,
            street: parts.street || null,
            street_number: parts.street_number || null,
            adcode: info.adcode != null ? String(info.adcode) : null,
            phone_area_code: info.phone_area_code != null ? String(info.phone_area_code) : null,
            nearest_poi: nearest,
            poi_count: numberOrNull(hit.poi_count),
        }];
    },
});
