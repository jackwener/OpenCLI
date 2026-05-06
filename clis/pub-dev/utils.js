// Shared helpers for the pub.dev adapters.
//
// Hits the public, unauthenticated `pub.dev/api` REST endpoints — the canonical
// Dart / Flutter package registry. No API key required; standard HTTP.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const PUB_BASE = 'https://pub.dev/api';
const UA = 'opencli-pub-dev-adapter/1.0 (+https://github.com/jackwener/opencli)';

// pub.dev package names: lowercase letters, digits, underscores. 1-64 chars per
// the Dart package layout spec; we mirror that conservatively.
const PACKAGE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`pub-dev ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`pub-dev ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`pub-dev ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requirePackageName(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('pub-dev package name is required (e.g. "http", "provider")');
    if (!PACKAGE_NAME.test(raw)) {
        throw new ArgumentError(
            `pub-dev package "${value}" is not a valid pub.dev package name`,
            'Use lowercase letters / digits / underscores; must start with a letter (Dart package layout).',
        );
    }
    return raw;
}

export async function pubFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that pub.dev is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `pub.dev returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'pub.dev throttles unauthenticated traffic; wait a few seconds and retry.',
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
