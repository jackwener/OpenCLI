// Shared helpers for the GBIF (`api.gbif.org`) adapter.
//
// GBIF is the Global Biodiversity Information Facility — a free, open
// taxonomy + occurrence database. The REST API at api.gbif.org/v1 is
// unauthenticated for read endpoints. Two endpoints we wrap:
//   GET /v1/species/search?q=…       fuzzy taxonomic search
//   GET /v1/occurrence/search?…      observation/specimen records
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const GBIF_BASE = 'https://api.gbif.org/v1';
const UA = 'opencli-gbif-adapter (+https://github.com/jackwener/opencli)';

// ISO 3166-1 alpha-2 country code (e.g. "US", "BR", "ZA").
const COUNTRY_PATTERN = /^[A-Z]{2}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`gbif ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`gbif ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`gbif ${label} must be <= ${maxValue}`);
    }
    return n;
}

/** Validate ISO 3166-1 alpha-2 country code (e.g. "US"). Returns null if not supplied. */
export function requireOptionalCountry(value) {
    if (value == null || value === '') return null;
    const s = String(value).trim().toUpperCase();
    if (!COUNTRY_PATTERN.test(s)) {
        throw new ArgumentError('gbif country must be a 2-letter ISO 3166-1 code (e.g. "US", "BR", "ZA")');
    }
    return s;
}

export async function gbifFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.gbif.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `GBIF returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'GBIF API throttles bursts; wait and retry.',
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

/** Build an ISO timestamp from GBIF's epoch-millis fields. Returns null on missing/zero. */
export function isoFromMillis(value) {
    if (value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n).toISOString();
}
