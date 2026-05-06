// jikan shared helpers — Jikan v4 (unofficial MyAnimeList REST, api.jikan.moe, no auth).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const JIKAN_BASE = 'https://api.jikan.moe/v4';
const UA = 'opencli-jikan/1.0';

export function requireString(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`--${name} is required`);
    }
    return value.trim();
}

export function requireBoundedInt(value, fallback, max) {
    const v = value == null ? fallback : Number(value);
    if (!Number.isInteger(v) || v < 1 || v > max) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${max}`);
    }
    return v;
}

export function requirePositiveInt(value, name) {
    const v = Number(value);
    if (!Number.isInteger(v) || v < 1) {
        throw new ArgumentError(`--${name} must be a positive integer (MAL id)`);
    }
    return v;
}

export async function jikanFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `${label} returned 404 (unknown id).`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} rate-limited (HTTP 429); Jikan caps free traffic at ~3 req/sec.`);
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

export function joinNamed(arr, key = 'name', limit = 5) {
    if (!Array.isArray(arr)) return '';
    return arr
        .slice(0, limit)
        .map((x) => String(x?.[key] ?? '').trim())
        .filter(Boolean)
        .join(', ');
}
