// frankfurter shared helpers — currency rates from frankfurter.app (ECB data, free, no auth).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';
const UA = 'opencli-frankfurter/1.0';

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireCurrency(value, name) {
    const v = requireString(value, name).toUpperCase();
    if (!CURRENCY_PATTERN.test(v)) {
        throw new ArgumentError(`--${name} must be an ISO 4217 currency code (3 letters, e.g. USD)`);
    }
    return v;
}

export function requireOptionalCurrency(value, name) {
    if (value == null || value === '') return null;
    return requireCurrency(value, name);
}

export function requireDate(value, name) {
    const v = requireString(value, name);
    if (!DATE_PATTERN.test(v)) {
        throw new ArgumentError(`--${name} must be YYYY-MM-DD`);
    }
    return v;
}

export function requireOptionalDate(value, name) {
    if (value == null || value === '') return null;
    return requireDate(value, name);
}

export async function frankfurterFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404 || resp.status === 422) {
        throw new EmptyResultError(label, `${label} returned ${resp.status}.`);
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
