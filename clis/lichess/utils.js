// Shared helpers for the lichess.org public REST adapters.
//
// Lichess exposes a generous unauthenticated API at `lichess.org/api`. We keep
// the surface narrow: `user` (profile) + `top` (per-perf top-N leaderboard).
// No API key required; rate limit is 60 req/min per IP.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const LICHESS_BASE = 'https://lichess.org';
const UA = 'opencli-lichess-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// Lichess usernames are 2-30 chars: letters, digits, underscore, dash. Case-insensitive.
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{2,30}$/;

// `perfType` values lichess accepts for the `/api/player/top/<n>/<perf>` endpoint.
// Source: lichess-org/api docs.
export const LICHESS_PERFS = new Set([
    'ultraBullet', 'bullet', 'blitz', 'rapid', 'classical',
    'chess960', 'crazyhouse', 'antichess', 'atomic', 'horde',
    'kingOfTheHill', 'racingKings', 'threeCheck',
]);

export function requireUsername(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('lichess username is required');
    if (!USERNAME_PATTERN.test(raw)) {
        throw new ArgumentError(
            `lichess username "${value}" is not a valid handle`,
            'Allowed: letters, digits, underscore, dash; length 2-30.',
        );
    }
    return raw;
}

export function requirePerf(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('lichess perf is required (e.g. "blitz", "bullet", "rapid")');
    if (!LICHESS_PERFS.has(raw)) {
        throw new ArgumentError(
            `lichess perf "${value}" is not recognised`,
            `Allowed values: ${[...LICHESS_PERFS].join(', ')}.`,
        );
    }
    return raw;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`lichess ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`lichess ${label} must be <= ${maxValue}`);
    }
    return n;
}

export async function lichessFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that lichess.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Lichess returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Lichess throttles anonymous traffic at ~60 req/min; back off and retry.',
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

/** Format a lichess unix-ms timestamp as ISO date (YYYY-MM-DD). `null` when missing. */
export function formatTimestamp(ms) {
    if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}
