// Shared helpers for the Packagist (PHP / Composer) adapters.
//
// Hits the public, unauthenticated `packagist.org` JSON endpoints. Composer's
// canonical package registry. Package names are `<vendor>/<package>`,
// lowercase letters / digits / `_-.`, with each segment 1-100 chars.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const PACKAGIST_BASE = 'https://packagist.org';
const UA = 'opencli-packagist-adapter (+https://github.com/jackwener/opencli)';

// Each segment of a Composer package name (`vendor` and `package`).
const SEGMENT = /^[a-z0-9]([_.-]?[a-z0-9]+)*$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`packagist ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`packagist ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`packagist ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requirePackageName(value) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) {
        throw new ArgumentError('packagist package name is required (e.g. "symfony/console", "monolog/monolog")');
    }
    const slash = raw.indexOf('/');
    if (slash <= 0 || slash === raw.length - 1) {
        throw new ArgumentError(
            `packagist package "${value}" must be "<vendor>/<package>"`,
            'Both segments are required (Composer convention).',
        );
    }
    const vendor = raw.slice(0, slash);
    const pkg = raw.slice(slash + 1);
    if (vendor.length > 100 || pkg.length > 100 || !SEGMENT.test(vendor) || !SEGMENT.test(pkg)) {
        throw new ArgumentError(
            `packagist package "${value}" is not a valid Composer name`,
            'Use lowercase letters / digits / "_-.", segments separated by single "_-." chars (max 100 chars each).',
        );
    }
    return { vendor, package: pkg, full: `${vendor}/${pkg}` };
}

export async function packagistFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that packagist.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Packagist returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Packagist throttles bursts; wait a few seconds and retry.',
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

/** Trim "2026-05-05T17:32:01+00:00" → "2026-05-05T17:32:01Z" so timestamps are uniform. */
export function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const noFrac = s.replace(/\.\d+/, '');
    return noFrac.replace(/(?:[+-]\d{2}:?\d{2}|Z)?$/, 'Z');
}

/**
 * Pick the newest stable (non-dev / non-prerelease) version key from a
 * Packagist `versions` map. Packagist returns keys ordered newest-first.
 * Falls back to the first key if no stable found.
 */
export function pickStableVersion(versions) {
    if (!versions || typeof versions !== 'object') return null;
    const keys = Object.keys(versions);
    if (!keys.length) return null;
    const PRE = /(?:^|[._\-+])(?:dev|alpha|beta|rc|pre|nightly)(?:[._\-+\d]|$)/i;
    const DEV_SUFFIX = /\.x-dev$|-dev$/i;
    for (const k of keys) {
        if (DEV_SUFFIX.test(k)) continue;
        if (PRE.test(k)) continue;
        return k;
    }
    return keys[0];
}
