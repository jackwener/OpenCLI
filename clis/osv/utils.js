// Shared helpers for the OSV.dev (Open Source Vulnerabilities) adapters.
//
// OSV.dev publishes a free, unauthenticated REST API at https://api.osv.dev.
// Docs: https://google.github.io/osv.dev/api/
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OSV_BASE = 'https://api.osv.dev';
const UA = 'opencli-osv-adapter (+https://github.com/jackwener/opencli)';

// OSV vulnerability IDs are short tokens like "GHSA-29mw-wpgm-hmr9", "CVE-2020-28500", "PYSEC-2021-1".
const VULN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

// OSV ecosystems we accept on input. The full canonical list is at
// https://ossf.github.io/osv-schema/#defined-ecosystems — we accept the public
// ones that map cleanly to package registries opencli already supports.
export const OSV_ECOSYSTEMS = new Set([
    'npm',
    'PyPI',
    'Go',
    'Maven',
    'NuGet',
    'RubyGems',
    'crates.io',
    'Packagist',
    'Pub',
    'Hex',
    'Hackage',
    'CRAN',
    'Bitnami',
    'GitHub Actions',
    'SwiftURL',
]);

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`osv ${label} cannot be empty`);
    return s;
}

export function requireVulnId(value) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(
            'osv vulnerability id is required (e.g. "GHSA-29mw-wpgm-hmr9", "CVE-2020-28500")',
            'IDs are listed at https://osv.dev — paste the canonical id from the vulnerability page.',
        );
    }
    if (!VULN_ID.test(s)) {
        throw new ArgumentError(
            `osv vulnerability id "${value}" is not a valid OSV id`,
            'IDs are short ASCII tokens like "GHSA-...", "CVE-...", "PYSEC-...".',
        );
    }
    return s;
}

export function requireEcosystem(value) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(
            'osv --ecosystem is required when querying by package',
            `Pick one of: ${[...OSV_ECOSYSTEMS].join(', ')}.`,
        );
    }
    if (!OSV_ECOSYSTEMS.has(s)) {
        throw new ArgumentError(
            `osv --ecosystem "${value}" is not a recognised OSV ecosystem`,
            `Pick one of: ${[...OSV_ECOSYSTEMS].join(', ')}.`,
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`osv ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`osv ${label} must be <= ${maxValue}`);
    }
    return n;
}

async function readJson(resp, label) {
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}

export async function osvGet(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.osv.dev is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `OSV.dev returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    return readJson(resp, label);
}

export async function osvPost(url, payload, label) {
    let resp;
    try {
        resp = await fetch(url, {
            method: 'POST',
            headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' },
            body: JSON.stringify(payload),
        });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.osv.dev is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `OSV.dev returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
    }
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }
    return readJson(resp, label);
}

// Reduce OSV's `severity` array to a single human-readable label.
// Returns null when no severity is recorded; never invents a value.
export function severityLabel(vuln) {
    const dbSpecific = vuln?.database_specific;
    if (dbSpecific && typeof dbSpecific.severity === 'string' && dbSpecific.severity.trim()) {
        return dbSpecific.severity.trim();
    }
    const arr = Array.isArray(vuln?.severity) ? vuln.severity : [];
    for (const entry of arr) {
        if (entry && typeof entry.score === 'string' && entry.score.trim()) {
            return entry.score.trim();
        }
    }
    return null;
}

export function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const noFrac = s.replace(/\.\d+/, '');
    return noFrac.endsWith('Z') ? noFrac : (s.length >= 10 ? s.slice(0, 10) : null);
}
