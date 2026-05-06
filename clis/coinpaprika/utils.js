// Coinpaprika public API — coin listing + ticker (price/market cap).
//
// Free tier at https://api.coinpaprika.com/v1. No API key required for read
// traffic; ~25k req/month per IP soft cap. Stable schema.
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';

export const CP_BASE = 'https://api.coinpaprika.com/v1';
const UA = 'opencli-coinpaprika/1.0';

export function requireBoundedInt(value, def, max, name = 'limit') {
    const n = value == null || value === '' ? def : Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) {
        throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    }
    return n;
}

export function requireNonEmpty(value, name) {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ArgumentError(`<${name}> is required and must be a non-empty string.`);
    }
    return value.trim();
}

export async function cpFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'User-Agent': UA, accept: 'application/json' } });
    } catch (err) {
        throw new CommandExecutionError(`${label} request failed: ${err.message}`);
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, 'coinpaprika.com returned no matches.');
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
