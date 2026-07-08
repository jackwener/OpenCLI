// Shared helpers for the RubyGems.org adapters.
//
// Hits the public, unauthenticated `rubygems.org/api/v1` REST endpoints. No
// auth required for read-only metadata; the API is friendly to anonymous CLI
// traffic. Gem names follow the RubyGems convention: lowercase ASCII +
// `-_.`, 1-100 chars, must start with a letter or digit.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const GEMS_BASE = 'https://rubygems.org/api/v1';
const UA = 'opencli-rubygems-adapter (+https://github.com/jackwener/opencli)';

// RubyGems gem name pattern (mirrors the rubygems-server validation).
const GEM_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`rubygems ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`rubygems ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`rubygems ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireGemName(value) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError('rubygems gem name is required (e.g. "rails", "sidekiq")');
    }
    if (s.length > 100 || !GEM_NAME.test(s)) {
        throw new ArgumentError(
            `rubygems gem "${value}" is not a valid gem name`,
            'Use letters / digits / "._-", starting with a letter or digit (max 100 chars).',
        );
    }
    return s;
}

export async function gemsFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that rubygems.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `RubyGems returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'RubyGems throttles bursts; wait a few seconds and retry.',
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

/** Trim "2026-03-24T20:27:42.098Z" → "2026-03-24T20:27:42Z" so timestamps share a uniform precision. */
export function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const noFrac = s.replace(/\.\d+/, '');
    return noFrac.endsWith('Z') ? noFrac : `${noFrac}Z`;
}
