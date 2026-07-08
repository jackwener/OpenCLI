// Shared helpers for the NuGet adapters.
//
// NuGet exposes two complementary endpoints:
//   • `azuresearch-usnc.nuget.org/query` — full-text package search (V3)
//   • `api.nuget.org/v3/registration5-semver1/<id>/index.json` — package detail
// No API key required. Anonymous traffic is generous; we set a polite UA.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const NUGET_SEARCH_BASE = 'https://azuresearch-usnc.nuget.org';
export const NUGET_REGISTRATION_BASE = 'https://api.nuget.org/v3/registration5-semver1';
const UA = 'opencli-nuget-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// NuGet ID grammar (NuGet docs §package-id): up to 100 chars, alnum + `.` + `_` + `-`,
// must start with letter/digit. Case-insensitive; we lowercase for the registration URL
// because NuGet's CDN is case-sensitive on the path.
const PACKAGE_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`nuget ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`nuget ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`nuget ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requirePackageId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('nuget package id is required (e.g. "Newtonsoft.Json")');
    if (!PACKAGE_ID_PATTERN.test(raw)) {
        throw new ArgumentError(
            `nuget package id "${value}" is not a valid NuGet identifier`,
            'NuGet IDs are 1-100 chars: letters/digits/`.`/`_`/`-`, starting with letter or digit.',
        );
    }
    return raw;
}

export async function nugetFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.nuget.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `NuGet returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
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

export function joinTags(tags) {
    if (!Array.isArray(tags)) return '';
    return tags.filter((t) => typeof t === 'string' && t.trim()).join(', ');
}

export function joinAuthors(authors) {
    if (Array.isArray(authors)) return authors.filter((a) => typeof a === 'string' && a.trim()).join(', ');
    if (typeof authors === 'string') return authors.trim();
    return '';
}
