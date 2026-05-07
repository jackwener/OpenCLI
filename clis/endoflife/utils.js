// Shared helpers for the endoflife.date adapters.
//
// endoflife.date publishes a free, unauthenticated REST API with cycle / EOL /
// LTS data for hundreds of products. Docs: https://endoflife.date/docs/api/
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const EOL_BASE = 'https://endoflife.date/api';
const UA = 'opencli-endoflife-adapter (+https://github.com/jackwener/opencli)';

// endoflife.date product slugs are lowercase ascii + digits + dashes / dots, up to 80 chars.
const PRODUCT = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export function requireProduct(value) {
    const s = String(value ?? '').trim().toLowerCase();
    if (!s) {
        throw new ArgumentError(
            'endoflife product is required (e.g. "nodejs", "python", "ubuntu")',
            'Use the slug visible at https://endoflife.date/<product>.',
        );
    }
    if (!PRODUCT.test(s)) {
        throw new ArgumentError(
            `endoflife product "${value}" is not a valid endoflife.date slug`,
            'Slugs are lowercase ASCII letters/digits/"._-", e.g. "nodejs", "python", "ubuntu".',
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`endoflife ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`endoflife ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function eolFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that endoflife.date is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `endoflife.date returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'endoflife.date throttles unauthenticated traffic; wait a few seconds and retry.',
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

// endoflife.date returns scalar fields that are either an ISO date "YYYY-MM-DD",
// a boolean (true = supported / ongoing, false = not LTS), or null. Normalise:
// - boolean true -> the literal string "ongoing"
// - boolean false -> null (matches "no LTS phase" / "not in extended support")
// - date string -> as-is
// - anything else -> null
export function normaliseDateOrFlag(value) {
    if (value === true) return 'ongoing';
    if (value === false || value == null) return null;
    if (typeof value === 'string') {
        const s = value.trim();
        return s || null;
    }
    return null;
}
