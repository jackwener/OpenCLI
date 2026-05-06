// Studio Ghibli API — films + characters (people).
//
// Public REST API at https://ghibliapi.vercel.app. No auth, no rate limit
// documented. Endpoints return JSON arrays directly. The dataset is
// finite/curated (~22 films, ~50 characters).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const GHIBLI_BASE = 'https://ghibliapi.vercel.app';
const UA = 'opencli-ghibli/1.0';

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export async function ghibliFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'ghibliapi.vercel.app returned no matches.');
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
