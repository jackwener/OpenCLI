// OpenF1 — Formula 1 telemetry, sessions, drivers (real-time + archive).
//
// Public API at https://api.openf1.org/v1. No auth, no rate limit officially
// documented (community-run; reasonable use expected). Filter via query
// params; server returns JSON arrays directly (no envelope).
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const OPENF1_BASE = 'https://api.openf1.org/v1';
const UA = 'opencli-openf1/1.0';

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export function optionalInt(value, name) {
    if (value == null || value === '') return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        throw new ArgumentError(`--${name} must be a positive integer (got ${value}).`);
    }
    return n;
}

export async function openf1Fetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'api.openf1.org returned no matches.');
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} rate-limited (HTTP 429); back off and retry.`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}.`);
    }
    let body;
    try {
        body = await resp.json();
    } catch (err) {
        throw new CommandExecutionError(`${label} returned non-JSON body: ${err.message}`);
    }
    return body;
}
