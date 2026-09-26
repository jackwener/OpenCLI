// tencent-map coordinate reference systems — pure math, no network.
//
// Tencent Maps serve GCJ-02 (国测局坐标 / "火星坐标"), the same datum Amap and
// most mainland Chinese map providers use. Devices hand out WGS-84 (GPS), and
// Baidu serves BD-09. `tencent-map convert` bridges all three locally: no API call, no
// quota, and it keeps working when the WebService is unreachable.
//
// The WGS-84 → GCJ-02 transform below is the canonical public-domain algorithm
// (Krasovsky 1940 ellipsoid + the standard polynomial offsets). It was
// cross-validated against Tencent's own `ws/coord/v1/translate?type=1`:
//
//   input  (WGS-84) 22.523055,113.935258
//   local           22.520025,113.940125
//   Tencent         22.520025,113.940125   → identical to 6 decimal places
import { ArgumentError } from '@jackwener/opencli/errors';

/** Krasovsky 1940 semi-major axis (metres). */
const A = 6378245.0;
/** Squared eccentricity of the Krasovsky 1940 ellipsoid. */
const EE = 0.00669342162296594323;
/** BD-09 magic constant: 3000 in a 180/π-scaled degree space. */
const X_PI = (Math.PI * 3000.0) / 180.0;

export const WGS84 = 'wgs84';
export const GCJ02 = 'gcj02';
export const BD09 = 'bd09';

export const CRS_NAMES = [WGS84, GCJ02, BD09];

// Friendly aliases so callers can say --from gps / --to tencent.
const CRS_ALIASES = new Map([
    ['wgs84', WGS84], ['wgs', WGS84], ['gps', WGS84], ['epsg4326', WGS84],
    ['gcj02', GCJ02], ['gcj-02', GCJ02], ['tencent', GCJ02], ['qq', GCJ02],
    ['amap', GCJ02], ['gaode', GCJ02], ['高德', GCJ02], ['腾讯', GCJ02],
    ['bd09', BD09], ['bd-09', BD09], ['baidu', BD09], ['百度', BD09],
]);

/** Resolve a user-supplied CRS name (or alias) to a canonical id. */
export function normalizeCrs(value, label) {
    const key = String(value ?? '').trim().toLowerCase();
    const crs = CRS_ALIASES.get(key);
    if (!crs) {
        throw new ArgumentError(
            `${label} must be one of: ${CRS_NAMES.join(', ')} (aliases: gps, tencent, baidu)`,
            `Got "${value}".`,
        );
    }
    return crs;
}

/**
 * The GCJ-02 obfuscation is only applied inside mainland China. Outside that
 * box every CRS coincides with WGS-84, so a conversion there is an identity —
 * callers should surface this rather than pretend a shift happened.
 */
export function outOfChina(lat, lng) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
    return ret;
}

function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
    return ret;
}

/** WGS-84 (GPS) → GCJ-02 (Tencent / Amap). Identity outside mainland China. */
export function wgs84ToGcj02(lat, lng) {
    if (outOfChina(lat, lng)) return [lat, lng];
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * Math.PI;
    let magic = Math.sin(radLat);
    magic = 1 - EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI);
    dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI);
    return [lat + dLat, lng + dLng];
}

/**
 * GCJ-02 → WGS-84. The forward transform has no closed-form inverse, so this
 * iterates the forward transform and corrects by the residual (converges to
 * ~1e-11 degrees, i.e. sub-micrometre, in under 10 rounds).
 */
export function gcj02ToWgs84(lat, lng) {
    if (outOfChina(lat, lng)) return [lat, lng];
    let wgsLat = lat;
    let wgsLng = lng;
    for (let i = 0; i < 30; i++) {
        const [gLat, gLng] = wgs84ToGcj02(wgsLat, wgsLng);
        const dLat = gLat - lat;
        const dLng = gLng - lng;
        if (Math.abs(dLat) < 1e-11 && Math.abs(dLng) < 1e-11) break;
        wgsLat -= dLat;
        wgsLng -= dLng;
    }
    return [wgsLat, wgsLng];
}

/** GCJ-02 → BD-09 (Baidu). Defined globally, not China-gated. */
export function gcj02ToBd09(lat, lng) {
    const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
    const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
    return [z * Math.sin(theta) + 0.006, z * Math.cos(theta) + 0.0065];
}

/** BD-09 (Baidu) → GCJ-02. */
export function bd09ToGcj02(lat, lng) {
    const x = lng - 0.0065;
    const y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
    return [z * Math.sin(theta), z * Math.cos(theta)];
}

/** Convert one coordinate pair between any two supported CRS. */
export function convertCoord(lat, lng, from, to) {
    if (from === to) return [lat, lng];
    let point = [lat, lng];
    if (from === BD09) point = bd09ToGcj02(point[0], point[1]);
    if (from === WGS84) point = wgs84ToGcj02(point[0], point[1]);
    if (to === BD09) return gcj02ToBd09(point[0], point[1]);
    if (to === WGS84) return gcj02ToWgs84(point[0], point[1]);
    return point;
}

/** Great-circle distance in metres (haversine, mean Earth radius). */
export function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371008.8;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/** Format a pair the way the getPoint page prints it: `lat,lng`, 6 decimals. */
export function formatLatLng(lat, lng) {
    return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const COORD_PAIR = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/;

/**
 * Parse one `lat,lng` pair. Tencent's own `location` parameter is latitude
 * first (the getPoint page shows `22.52…,113.93…`), so a pair whose first
 * component cannot be a latitude is rejected with a swap hint instead of being
 * silently reinterpreted.
 */
export function parseLatLng(value, label = 'location') {
    const match = COORD_PAIR.exec(String(value ?? ''));
    if (!match) {
        throw new ArgumentError(
            `${label} must look like "lat,lng" (e.g. 22.522807,113.935338)`,
            `Got "${value}".`,
        );
    }
    const first = Number(match[1]);
    const second = Number(match[2]);
    if (Math.abs(first) > 90 && Math.abs(second) <= 90) {
        throw new ArgumentError(
            `${label} looks like "lng,lat"; Tencent expects "lat,lng"`,
            `Did you mean ${formatLatLng(second, first)}?`,
        );
    }
    if (Math.abs(first) > 90 || Math.abs(second) > 180) {
        throw new ArgumentError(
            `${label} is out of range: latitude must be within [-90,90] and longitude within [-180,180]`,
            `Got "${value}".`,
        );
    }
    return { lat: first, lng: second };
}

/** Parse one or more `lat,lng` pairs separated by `;`, `|` or newlines. */
export function parseLatLngList(value, label = 'coords') {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError(`${label} is required`, 'Pass one or more "lat,lng" pairs.');
    }
    const parts = raw.split(/[;|\n]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
        throw new ArgumentError(`${label} is required`, 'Pass one or more "lat,lng" pairs.');
    }
    return parts.map((part) => parseLatLng(part, label));
}
