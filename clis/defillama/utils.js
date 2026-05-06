// Shared helpers for the DefiLlama adapters.
//
// DefiLlama serves a public REST API (no auth) over https://api.llama.fi.
// Docs: https://defillama.com/docs/api
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const LLAMA_BASE = 'https://api.llama.fi';
const UA = 'opencli-defillama-adapter (+https://github.com/jackwener/opencli)';

// DefiLlama slugs are lowercase with hyphens / digits / dots; allow up to 100 chars.
const SLUG = /^[a-z0-9][a-z0-9._-]{0,99}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`defillama ${label} cannot be empty`);
    return s;
}

export function requireSlug(value, label = 'slug') {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(
            `defillama ${label} is required (e.g. "aave", "lido")`,
            'Use the protocol slug as it appears on https://defillama.com/protocol/<slug>.',
        );
    }
    if (!SLUG.test(s)) {
        throw new ArgumentError(
            `defillama ${label} "${value}" is not a valid DefiLlama slug`,
            'Slugs are lowercase ASCII (letters / digits / "._-"), e.g. "aave", "lido", "pancakeswap-amm".',
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`defillama ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`defillama ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function llamaFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that api.llama.fi is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `DefiLlama returned 404 for ${url}.`);
    }
    if (resp.status === 400) {
        // DefiLlama returns 400 + plain-text "Protocol not found" for unknown slugs.
        const body = await resp.text().catch(() => '');
        if (/not\s*found/i.test(body)) {
            throw new EmptyResultError(label, `DefiLlama: ${body.trim() || 'not found'}.`);
        }
        throw new CommandExecutionError(`${label} returned HTTP 400: ${body.slice(0, 200)}`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'DefiLlama throttles unauthenticated traffic; wait a few seconds and retry.',
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

// Convert a unix-seconds timestamp (DefiLlama's listedAt convention) to YYYY-MM-DD,
// or null when the value is missing / not a finite number.
export function unixToDate(value) {
    if (value == null) return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}
