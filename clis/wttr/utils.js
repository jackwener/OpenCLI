// wttr.in shared helpers — global weather (no auth, terminal-friendly JSON via ?format=j1).
//
// Coverage: worldwide. Unlike NWS (US-only), wttr.in geocodes any city/airport
// code/lat,lon string and serves a 3-day forecast + current conditions in one
// payload.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const WTTR_BASE = 'https://wttr.in';
const UA = 'opencli-wttr/1.0';

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export async function wttrFetch(location, label) {
    // wttr.in path-encodes the location. Spaces → %20 is fine; commas survive.
    const url = `${WTTR_BASE}/${encodeURIComponent(location)}?format=j1`;
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} could not find location "${location}".`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        // wttr.in falls back to plain-text "Unknown location" for some bad inputs;
        // promote that to EmptyResult instead of pretending we got JSON.
        throw new EmptyResultError(label, `${label} returned non-JSON body (likely unknown location).`);
    }
    return body;
}

// wttr.in's "weatherDesc" / "lang_en" fields are arrays of `{ value: '...' }` objects.
// Single-element 99% of the time but the schema is a list.
export function pickWeatherDesc(arr) {
    if (!Array.isArray(arr) || !arr.length) return '';
    const first = arr[0];
    return typeof first?.value === 'string' ? first.value.trim() : '';
}
