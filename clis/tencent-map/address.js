// tencent-map address — forward geocoding: a full address string → one coordinate.
//
// Tencent's geocoder refuses an address that carries no city component:
// `天安门` answers `348 参数错误` while `北京市天安门` resolves. `--region` exists
// exactly for that case — it is folded into the query text (the gateway has no
// separate region parameter) and the text that was actually sent comes back in
// the `query` column, so nothing happens off-screen.
//
// Matching is fuzzy even on success, so the row carries the API's own
// confidence fields (`similarity` 0-1, `reliability` 1-10, `level`, `deviation`
// in metres) rather than a hand-rolled verdict. The trap they expose: asking
// for a house number that does not exist still answers `status 0` with
// `similarity 0.99` and `deviation 1000` — the tell is that `title` and `level`
// collapse from the POI (腾讯滨海大厦, level 10) to the street (海天二路,
// level 7). `--verify` is the authoritative check: it reverse-geocodes the
// resolved point and reports what that coordinate actually is.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { APPTAG, STATUS_BAD_ARGUMENT, assembleAddress, emptyResult, requireString, tmapRequest } from './utils.js';
import { formatLatLng } from './coords.js';

const ARGUMENT_HINT = 'Tencent needs a city in the text: try `--region 深圳市`, use the full 省/市/区/街道/门牌, '
    + 'or use `opencli tencent-map search <关键词>` for a fuzzy nationwide lookup.';

const COLUMNS = [
    'query', 'title', 'address', 'lat', 'lng',
    'province', 'city', 'district', 'street', 'street_number',
    'adcode', 'similarity', 'reliability', 'level', 'deviation', 'verify_address',
];

/** Join the address components, collapsing the province==city of municipalities. */
function composeAddress(parts) {
    const out = [];
    for (const part of parts) {
        const text = typeof part === 'string' ? part.trim() : '';
        if (!text || out[out.length - 1] === text) continue;
        out.push(text);
    }
    return out.join('');
}

/**
 * Tencent returns a bare house number ("33") but writes it as "33号" everywhere
 * it renders a full address. Restore the suffix, and only for a purely numeric
 * number so "33-1" / "甲33" / "33号" pass through untouched.
 */
function houseNumberOf(streetNumber) {
    const text = typeof streetNumber === 'string' ? streetNumber.trim() : '';
    if (!text) return '';
    return /^\d+$/.test(text) ? `${text}号` : text;
}

function numberOrNull(value) {
    return Number.isFinite(Number(value)) ? Number(value) : null;
}

cli({
    site: 'tencent-map',
    name: 'address',
    access: 'read',
    description: '腾讯地图正向地理编码：完整地址 → 坐标（可用 --verify 反查该坐标的真实地址）',
    domain: 'h5gw.map.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'address', type: 'string', required: true, positional: true, help: '地址文本，需含城市，如「深圳市南山区海天二路33号」' },
        { name: 'region', type: 'string', default: '', help: '城市名；当地址里没写城市时作为前缀补充（网关没有独立的 region 参数）' },
        { name: 'verify', type: 'bool', default: false, help: '对解析出的坐标再做一次反查，把该点真实的地址填进 verify_address' },
    ],
    columns: COLUMNS,
    func: async (args) => {
        const address = requireString(args.address, 'address');
        const query = assembleAddress(args.region, address);

        const body = await tmapRequest('/geocoder/v1/', { address: query }, 'tencent-map address', {
            apptag: APPTAG.geocoder,
            treatStatusAsArgument: [STATUS_BAD_ARGUMENT],
            argumentHint: ARGUMENT_HINT,
        });

        const hit = body.result;
        if (!hit || typeof hit !== 'object') {
            throw emptyResult('tencent-map address', `No coordinate resolved for "${query}".`);
        }
        const point = hit.location && typeof hit.location === 'object' ? hit.location : {};
        const lat = numberOrNull(point.lat);
        const lng = numberOrNull(point.lng);
        if (lat === null || lng === null) {
            throw emptyResult('tencent-map address', `Tencent returned no coordinate for "${query}".`);
        }
        const parts = hit.address_components && typeof hit.address_components === 'object' ? hit.address_components : {};

        let verifyAddress = null;
        if (args.verify) {
            const reverse = await tmapRequest('/geocoder/v1/', {
                location: formatLatLng(lat, lng),
            }, 'tencent-map address --verify', { apptag: APPTAG.geocoder });
            const back = reverse.result;
            if (back && typeof back === 'object') {
                const formatted = back.formatted_addresses && typeof back.formatted_addresses === 'object'
                    ? back.formatted_addresses
                    : {};
                verifyAddress = formatted.standard_address || back.address || null;
            }
        }

        return [{
            query,
            title: typeof hit.title === 'string' ? hit.title : null,
            address: composeAddress([parts.province, parts.city, parts.district, parts.street, houseNumberOf(parts.street_number)]) || null,
            lat,
            lng,
            province: parts.province || null,
            city: parts.city || null,
            district: parts.district || null,
            street: parts.street || null,
            street_number: parts.street_number || null,
            adcode: hit.ad_info && hit.ad_info.adcode != null ? String(hit.ad_info.adcode) : null,
            similarity: numberOrNull(hit.similarity),
            reliability: numberOrNull(hit.reliability),
            level: numberOrNull(hit.level),
            deviation: numberOrNull(hit.deviation),
            verify_address: verifyAddress,
        }];
    },
});
