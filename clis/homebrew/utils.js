// Shared helpers for the Homebrew adapters.
//
// Hits the public, unauthenticated `formulae.brew.sh/api` JSON endpoints
// (served as static files from GitHub Pages, regenerated daily). No auth.
// Formula / cask tokens are lowercase ASCII + `-_.+@` per Homebrew's own
// validation; they round-trip into `homebrew formula` / `homebrew cask`.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const BREW_BASE = 'https://formulae.brew.sh/api';
const UA = 'opencli-homebrew-adapter (+https://github.com/jackwener/opencli)';

// Homebrew formula / cask tokens — letters / digits / `_-.+@` (`gcc@13`,
// `imagemagick@6`, `c++`, `0-ad`, `php-cs-fixer`).
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._+@-]*$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`homebrew ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`homebrew ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`homebrew ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireToken(value, label) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(`homebrew ${label} is required (e.g. "wget", "gcc@13", "firefox")`);
    }
    if (s.length > 100 || !TOKEN.test(s)) {
        throw new ArgumentError(
            `homebrew ${label} "${value}" is not a valid token`,
            'Use letters / digits / "_-.+@", starting with a letter or digit (max 100 chars).',
        );
    }
    return s;
}

export function requireOneOf(value, allowed, label) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) throw new ArgumentError(`homebrew ${label} is required`);
    if (!allowed.includes(s)) {
        throw new ArgumentError(
            `homebrew ${label} "${value}" is not supported`,
            `Allowed: ${allowed.join(', ')}.`,
        );
    }
    return s;
}

export async function brewFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that formulae.brew.sh is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Homebrew API returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Homebrew throttles bursts; wait a few seconds and retry.',
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

/** Coerce a count value (which Homebrew analytics serves as `"139,972"`) to a plain number. */
export function parseInstallCount(value) {
    if (value == null) return null;
    const s = String(value).replace(/,/g, '').trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
