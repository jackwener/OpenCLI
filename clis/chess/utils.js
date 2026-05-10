// Shared helpers for Chess.com adapter.
//
// Chess.com has a public REST API at `api.chess.com/pub/`. However, the PGN
// data returned by the API has a 20-30% corruption rate (truncated / malformed
// moves around move 11+). For reliable PGN extraction we fall back to the
// browser via the Share → Copy PGN flow in the logged-in Chrome session.
//
// Rate limit: ~1000 req/day per IP for the public endpoints.
// Authenticated (cookie-based) requests have higher limits.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const CHESS_COM_BASE = 'https://www.chess.com';
export const CHESS_COM_API = 'https://api.chess.com/pub';

// Chess.com usernames: 3-30 chars, letters/digits/underscore/hyphen. Case-insensitive.
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,30}$/;

// Time control classification based on initial time (seconds).
export function classifyTimeControl(initialTime, increment) {
    const total = initialTime + (increment || 0);
    if (initialTime < 30) return 'ultraBullet';
    if (initialTime < 180) return 'bullet';
    if (initialTime < 600) return 'blitz';
    if (initialTime < 3600) return 'rapid';
    return 'classical';
}

export function requireUsername(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('chess username is required');
    if (!USERNAME_PATTERN.test(raw)) {
        throw new ArgumentError(
            `chess username "${value}" is not a valid handle`,
            'Allowed: letters, digits, underscore, hyphen; length 3-30.',
        );
    }
    return raw;
}

export function requireGameId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('game ID is required');
    // Chess.com game IDs are numeric (e.g., 167564728910)
    if (!/^\d+$/.test(raw)) {
        throw new ArgumentError(`game ID "${value}" must be numeric`);
    }
    return raw;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`chess ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`chess ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Fetch JSON from Chess.com API with error handling.
 * @param {string} url - Full URL to fetch
 * @param {string} label - Label for error messages
 * @param {boolean} isBrowser - Whether this will run in browser context (for credentials mode)
 */
export async function chessComFetch(url, label, isBrowser = false) {
    let resp;
    try {
        const opts = {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'opencli-chess-adapter/1.0 (+https://github.com/jackwener/opencli)',
            },
        };
        // Browser context should include credentials (cookies) for authenticated requests
        if (isBrowser) {
            opts.credentials = 'include';
        }
        resp = await fetch(url, opts);
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that chess.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Chess.com returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Chess.com throttles anonymous traffic; back off and retry.',
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

/**
 * Format Unix timestamp to ISO date string.
 * @param {number} ts - Unix timestamp in seconds
 */
export function formatTimestamp(ts) {
    if (typeof ts !== 'number' || !Number.isFinite(ts) || ts <= 0) return null;
    const d = new Date(ts * 1000); // Chess.com uses seconds, JS uses milliseconds
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().split('T')[0]; // Return YYYY-MM-DD
}

/**
 * Determine game result from white/black perspective.
 * @param {string} result - 'win', 'loss', 'checkmated', 'resigned', 'timeout', etc.
 * @param {string} whiteResult - 'win', 'agreed', '1/2-1/2', etc.
 */
export function parseResult(result, whiteResult) {
    if (!result || result === 'no win') return null;
    // Normalize result
    const r = result.toLowerCase();
    if (r.includes('win')) return 'white-wins';
    if (r.includes('loss')) return 'white-loses';
    if (r.includes('draw') || r === 'agreed' || r === 'repetition' || r === 'stalemate' || r === 'timevsinsufficient') return 'draw';
    return result;
}
