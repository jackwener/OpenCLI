// worldbank shared helpers — World Bank Open Data API (api.worldbank.org/v2, no auth).
//
// Quirk: World Bank wraps every JSON response in a 2-element array
// [meta, results]. Helpers below unwrap so callers can think in terms of
// the result list directly.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const WB_BASE = 'https://api.worldbank.org/v2';
const UA = 'opencli-worldbank/1.0';

const ISO_PATTERN = /^[A-Z0-9]{2,3}$/;

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireCountry(value, name) {
    const v = requireString(value, name).toUpperCase();
    if (!ISO_PATTERN.test(v)) {
        throw new ArgumentError(`--${name} must be a 2- or 3-letter ISO country code (e.g. US, USA)`);
    }
    return v;
}

export function requireIndicator(value, name) {
    const v = requireString(value, name).toUpperCase();
    // World Bank indicator codes look like NY.GDP.MKTP.CD — letters / digits / dots
    if (!/^[A-Z0-9.]{3,40}$/.test(v)) {
        throw new ArgumentError(`--${name} must be a World Bank indicator code (e.g. NY.GDP.MKTP.CD)`);
    }
    return v;
}

export async function wbFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404.`);
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
    // World Bank shape: [meta, results]. If the wrapper is missing or empty,
    // surface as EmptyResult — they often signal "country not found" with
    // `[{ message: [{...}]}]` which has no second element.
    if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
        throw new EmptyResultError(label, `${label} returned no results (likely unknown country/indicator).`);
    }
    return { meta: body[0] ?? {}, results: body[1] };
}
