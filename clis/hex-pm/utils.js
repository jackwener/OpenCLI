// Shared helpers for the Hex.pm adapters.
//
// Hits the public, unauthenticated `hex.pm/api` REST endpoints — the canonical
// Erlang / Elixir package registry. No API key required.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const HEX_BASE = 'https://hex.pm/api';
const UA = 'opencli-hex-pm-adapter/1.0 (+https://github.com/jackwener/opencli)';

// Hex package names: lowercase letters, digits, underscores. Same general shape
// as Erlang module names.
const PACKAGE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`hex-pm ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`hex-pm ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`hex-pm ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requirePackageName(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('hex-pm package name is required (e.g. "phoenix", "ecto")');
    if (!PACKAGE_NAME.test(raw)) {
        throw new ArgumentError(
            `hex-pm package "${value}" is not a valid Hex package name`,
            'Use lowercase letters / digits / underscores; must start with a letter.',
        );
    }
    return raw;
}

export async function hexFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that hex.pm is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `hex.pm returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'hex.pm throttles unauthenticated traffic; wait a few seconds and retry.',
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
