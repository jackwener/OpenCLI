// Shared helpers for the MusicBrainz adapters.
//
// Hits the public, unauthenticated `musicbrainz.org/ws/2` REST endpoints — the
// canonical open music metadata registry. MusicBrainz strictly enforces a
// descriptive User-Agent and 1 req/s rate limit on anonymous traffic; we send
// a polite UA and surface 503/429 explicitly.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const MB_BASE = 'https://musicbrainz.org/ws/2';
const UA = 'opencli-musicbrainz-adapter/1.0 (+https://github.com/jackwener/opencli)';

// MusicBrainz uses lowercase MBIDs (UUID v4 format). Validate strictly so a
// typo doesn't waste a precious anonymous request slot.
const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`musicbrainz ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`musicbrainz ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`musicbrainz ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireMbid(value, label) {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) throw new ArgumentError(`musicbrainz ${label} mbid is required`);
    if (!MBID.test(raw)) {
        throw new ArgumentError(
            `musicbrainz ${label} "${value}" is not a valid MBID`,
            'Expected a UUID-v4-shaped MusicBrainz id (e.g. "a74b1b7f-71a5-4011-9441-d0b5e4122711").',
        );
    }
    return raw;
}

export function formatArtistCredit(credits) {
    if (!Array.isArray(credits)) return '';
    // joinphrase is the connective glue (e.g. " & ", " feat. ") that MusicBrainz
    // emits *with surrounding whitespace* — preserve it verbatim so multi-artist
    // credits stay readable. Only trim the final result.
    return credits
        .map((c) => {
            const name = String(c?.name ?? c?.artist?.name ?? '');
            const join = String(c?.joinphrase ?? '');
            return `${name}${join}`;
        })
        .join('')
        .trim();
}

export async function mbFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that musicbrainz.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `MusicBrainz returned 404 for ${url}.`);
    }
    if (resp.status === 429 || resp.status === 503) {
        throw new CommandExecutionError(
            `${label} returned HTTP ${resp.status} (rate limited)`,
            'MusicBrainz throttles anonymous traffic to 1 req/s; wait a few seconds and retry.',
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
