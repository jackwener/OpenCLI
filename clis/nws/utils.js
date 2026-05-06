// nws shared helpers — National Weather Service public API (api.weather.gov, no auth).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const NWS_BASE = 'https://api.weather.gov';
// NWS strongly recommends an identifying User-Agent so support can contact you on issues.
const UA = 'opencli-nws/1.0 (https://github.com/jackwener/opencli)';

const COORD_PATTERN = /^-?\d{1,3}(?:\.\d+)?,-?\d{1,3}(?:\.\d+)?$/;
const STATE_PATTERN = /^[A-Z]{2}$/;

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireCoord(value, name) {
    const v = requireString(value, name).replace(/\s+/g, '');
    if (!COORD_PATTERN.test(v)) {
        throw new ArgumentError(`--${name} must be "lat,lon" decimal degrees (e.g. "37.7749,-122.4194")`);
    }
    const [lat, lon] = v.split(',').map(Number);
    if (lat < -90 || lat > 90) throw new ArgumentError(`--${name} latitude out of range`);
    if (lon < -180 || lon > 180) throw new ArgumentError(`--${name} longitude out of range`);
    return { lat, lon, str: `${lat},${lon}` };
}

export function requireOptionalState(value, name) {
    if (value == null || value === '') return null;
    const v = requireString(value, name).toUpperCase();
    if (!STATE_PATTERN.test(v)) {
        throw new ArgumentError(`--${name} must be a 2-letter US state code (e.g. CA)`);
    }
    return v;
}

export async function nwsFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/geo+json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    try {
        return await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
}
