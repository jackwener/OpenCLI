// Shared helpers for the npm adapters that hit the public npm registry
// (registry.npmjs.org) and download stats API (api.npmjs.org).
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const NPM_REGISTRY = 'https://registry.npmjs.org';
export const NPM_API = 'https://api.npmjs.org';
const UA = 'opencli-npm-adapter (+https://github.com/jackwener/opencli)';

// npm package names: 1-214 chars, lowercase letters/numbers/-._ , scoped form `@scope/name`.
const PKG_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`npm ${label} cannot be empty`);
    return s;
}

export function requirePackageName(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('npm package name is required (e.g. "react", "@vercel/og")');
    if (s.length > 214) {
        throw new ArgumentError(`npm package name "${value}" is too long (max 214 chars)`);
    }
    if (!PKG_NAME.test(s)) {
        throw new ArgumentError(
            `npm package name "${value}" is not a valid registry name`,
            'Names are 1–214 chars of lowercase a-z / 0-9 / "-._" (scoped form: "@scope/name").',
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`npm ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`npm ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function npmFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that registry.npmjs.org / api.npmjs.org are reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `npm registry returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'npm throttles unauthenticated bursts; wait a few seconds and retry.',
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
