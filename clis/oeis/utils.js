// Shared helpers for the OEIS adapter (Online Encyclopedia of Integer Sequences).
//
// OEIS exposes a single search endpoint that handles both keyword search and
// id lookup via `q=id:Annnnnn`. JSON output via `fmt=json`. No API key.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OEIS_BASE = 'https://oeis.org';
const UA = 'opencli-oeis-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// OEIS ids are A followed by 6 zero-padded digits (older entries use 6 by convention,
// modern entries can be longer; OEIS itself accepts any digits after A).
const SEQUENCE_ID_PATTERN = /^A\d{1,7}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`oeis ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`oeis ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`oeis ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireSequenceId(value) {
    const raw = String(value ?? '').trim().toUpperCase();
    if (!raw) throw new ArgumentError('oeis sequence id is required (e.g. "A000045" for Fibonacci)');
    // Tolerate common URL paste like `https://oeis.org/A000045`.
    const stripped = raw.replace(/^HTTPS?:\/\/(?:WWW\.)?OEIS\.ORG\//, '').replace(/\/.*$/, '');
    if (!SEQUENCE_ID_PATTERN.test(stripped)) {
        throw new ArgumentError(
            `oeis sequence id "${value}" is not a valid A-number`,
            'Expected format: "A" + digits (e.g. "A000045").',
        );
    }
    return stripped;
}

export async function oeisFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that oeis.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `OEIS returned 404 for ${url}.`);
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

/** Format OEIS' `number: 40` into the canonical zero-padded id `A000040`. */
export function formatId(number) {
    if (typeof number !== 'number' || !Number.isInteger(number) || number < 0) return null;
    return `A${String(number).padStart(6, '0')}`;
}

/** Take the first N comma-separated terms from OEIS' `data` string. */
export function previewTerms(data, max = 12) {
    if (typeof data !== 'string') return '';
    const terms = data.split(',').map((t) => t.trim()).filter(Boolean);
    if (terms.length <= max) return terms.join(', ');
    return [...terms.slice(0, max), `(+${terms.length - max})`].join(', ');
}
