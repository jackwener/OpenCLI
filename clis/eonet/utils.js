// NASA EONET (Earth Observatory Natural Event Tracker).
//
// Public API at https://eonet.gsfc.nasa.gov/api/v3. No auth, generous rate limits.
// Returns natural events (wildfires, volcanoes, storms, ice/icebergs) with
// geometries (point or polygon) and category tags.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const EONET_BASE = 'https://eonet.gsfc.nasa.gov/api/v3';
const UA = 'opencli-eonet/1.0';

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export async function eonetFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'eonet.gsfc.nasa.gov returned no matches.');
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} rate-limited (HTTP 429); back off and retry.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
    return body;
}
