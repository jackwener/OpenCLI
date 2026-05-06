// Shared helpers for the Open-Meteo adapters.
//
// Hits the public, unauthenticated `api.open-meteo.com` and
// `geocoding-api.open-meteo.com` endpoints — Open-Meteo is a free weather +
// geocoding service that does not require an API key. Two-host setup so we
// keep the host wiring centralised.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const FORECAST_BASE = 'https://api.open-meteo.com/v1';
export const GEOCODE_BASE = 'https://geocoding-api.open-meteo.com/v1';
const UA = 'opencli-open-meteo-adapter/1.0 (+https://github.com/jackwener/opencli)';

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`open-meteo ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit', minValue = 1) {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n < minValue) {
        throw new ArgumentError(`open-meteo ${label} must be an integer >= ${minValue}`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`open-meteo ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireFloat(value, label, { min, max } = {}) {
    if (value === null || value === undefined || value === '') {
        throw new ArgumentError(`open-meteo ${label} is required`);
    }
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) {
        throw new ArgumentError(`open-meteo ${label} must be a finite number (got "${value}")`);
    }
    if (typeof min === 'number' && n < min) {
        throw new ArgumentError(`open-meteo ${label} must be >= ${min}`);
    }
    if (typeof max === 'number' && n > max) {
        throw new ArgumentError(`open-meteo ${label} must be <= ${max}`);
    }
    return n;
}

export async function meteoFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that *.open-meteo.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Open-Meteo returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Open-Meteo throttles unauthenticated traffic at ~10k req/day; wait and retry.',
        );
    }
    if (resp.status === 400) {
        // Open-Meteo serves rich JSON 400s for bad params; surface the reason.
        let detail = '';
        try { const j = await resp.json(); detail = j?.reason ? ` (${j.reason})` : ''; } catch { /* noop */ }
        throw new CommandExecutionError(`${label} returned HTTP 400${detail}`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}
