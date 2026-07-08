// Shared helpers for the crates.io adapters.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const CRATES_BASE = 'https://crates.io';
const UA = 'opencli-crates-adapter (+https://github.com/jackwener/opencli)';

// crates.io crate names: 1-64 chars, ascii letters/digits/-_, must start with a letter.
const CRATE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`crates ${label} cannot be empty`);
    return s;
}

export function requireCrateName(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('crates crate name is required (e.g. "serde", "tokio")');
    if (!CRATE_NAME.test(s)) {
        throw new ArgumentError(
            `crates crate name "${value}" is not a valid crates.io name`,
            'Names start with an ASCII letter, then 0-63 chars of letters / digits / "_-".',
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`crates ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`crates ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function cratesFetch(url, label) {
    let resp;
    try {
        // crates.io requires a descriptive User-Agent per https://crates.io/data-access
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that crates.io is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `crates.io returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'crates.io rate-limits unauthenticated traffic; wait a few seconds and retry.',
        );
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
