// Shared helpers for the Flathub adapters (https://flathub.org).
//
// Flathub is the canonical Linux flatpak app registry. Public REST API at
// `flathub.org/api/v2`, no auth, no key. Two endpoints we surface:
//   • POST /search      → keyword search, returns app metadata
//   • GET  /appstream/<appId> → full appstream metadata for one app
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const FLATHUB_API_BASE = 'https://flathub.org/api/v2';
export const FLATHUB_APP_BASE = 'https://flathub.org/apps';
const UA = 'opencli-flathub-adapter/1.0 (+https://github.com/jackwener/opencli; mailto:opencli@example.com)';

// AppStream IDs are reverse-DNS (e.g. "org.gnome.Calculator"); the spec allows
// letters, digits, `.`, `_`, `-`. Min two segments separated by `.`.
const APP_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_][A-Za-z0-9_-]*){1,}$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`flathub ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`flathub ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`flathub ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireAppId(value) {
    const raw = String(value ?? '').trim();
    if (!raw) throw new ArgumentError('flathub appId is required (e.g. "org.mozilla.firefox")');
    if (!APP_ID_PATTERN.test(raw)) {
        throw new ArgumentError(
            `flathub appId "${value}" is not a valid AppStream identifier`,
            'AppStream IDs use reverse-DNS like "org.mozilla.firefox" — letters/digits/`._-` with at least one dot.',
        );
    }
    return raw;
}

export async function flathubFetch(url, label, init) {
    let resp;
    try {
        resp = await fetch(url, {
            method: init?.method ?? 'GET',
            headers: { 'user-agent': UA, accept: 'application/json', ...(init?.headers ?? {}) },
            body: init?.body,
        });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that flathub.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Flathub returned 404 for ${url}.`);
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

export function joinList(value, max = 10) {
    if (!Array.isArray(value)) return '';
    const items = value.filter((v) => typeof v === 'string' && v.trim());
    if (items.length === 0) return '';
    if (items.length > max) return [...items.slice(0, max), `(+${items.length - max})`].join(', ');
    return items.join(', ');
}

// Coerce flathub's `timestamp` field (sometimes int, sometimes numeric string).
function timestampNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
    return 0;
}

/** Pick the most recent appstream `releases[].version` if present. */
export function pickLatestRelease(releases) {
    if (!Array.isArray(releases) || releases.length === 0) return { version: null, date: null };
    // releases[].timestamp is unix-seconds; flathub returns either int or numeric string.
    const sorted = [...releases].filter((r) => r && typeof r === 'object').sort((a, b) => {
        return timestampNumber(b?.timestamp) - timestampNumber(a?.timestamp);
    });
    const top = sorted[0];
    if (!top) return { version: null, date: null };
    let date = null;
    const ts = timestampNumber(top.timestamp);
    if (ts > 0) {
        const d = new Date(ts * 1000);
        if (!Number.isNaN(d.getTime())) date = d.toISOString().slice(0, 10);
    }
    // Fallback: appstream emits `date` as ISO string ("2024-12-09") for some apps.
    if (!date && typeof top.date === 'string' && top.date.trim()) date = top.date.trim();
    return { version: typeof top.version === 'string' ? top.version : null, date };
}
