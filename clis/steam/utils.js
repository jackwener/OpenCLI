// Shared helpers for the steam adapters that hit Steam's storefront JSON
// endpoints (no browser).
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const STEAM_STORE = 'https://store.steampowered.com';
const UA = 'opencli-steam-adapter (+https://github.com/jackwener/opencli)';

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(`steam ${label} cannot be empty`);
    }
    return s;
}

export function requireCountryCode(value, defaultValue = 'us') {
    const raw = value === undefined || value === null ? defaultValue : value;
    const code = String(raw).trim().toLowerCase();
    if (!/^[a-z]{2}$/.test(code)) {
        throw new ArgumentError(
            `steam currency must be a two-letter storefront country code (got "${value}")`,
            'Examples: us, cn, jp, de. This controls Steam regional pricing and availability.',
        );
    }
    return code;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`steam ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`steam ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireAppId(value) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError('steam app id is required (e.g. "620" for Portal 2)');
    }
    if (!/^\d+$/.test(s)) {
        throw new ArgumentError(
            `steam app id "${value}" must be a positive integer`,
            'Copy the numeric id from `steam search` or the URL `store.steampowered.com/app/<id>/`.',
        );
    }
    return s;
}

export async function steamFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that store.steampowered.com is reachable from this network.',
        );
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Steam throttles bursty traffic; wait a few seconds and retry.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'Steam returned 404 — the resource does not exist.');
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

export function asString(value) {
    return value == null ? '' : String(value);
}

const HTML_ENTITIES = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ',
};

export function decodeHtmlEntities(value) {
    return String(value ?? '')
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
        .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (m) => HTML_ENTITIES[m] || m);
}

export function priceCents(cents) {
    if (cents == null || cents === '') return null;
    const n = Number(cents);
    if (!Number.isFinite(n)) return null;
    return Number((n / 100).toFixed(2));
}
