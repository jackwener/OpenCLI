// Shared helpers for the Go module proxy adapters.
//
// proxy.golang.org is the canonical Go module proxy. It is unauthenticated
// and serves the GOPROXY protocol (`@latest`, `@v/list`, `@v/<ver>.info|mod|zip`).
// Spec: https://go.dev/ref/mod#goproxy-protocol
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const GOPROXY_BASE = 'https://proxy.golang.org';
const UA = 'opencli-goproxy-adapter (+https://github.com/jackwener/opencli)';

// Module paths look like host/path/...; conservative shape: at least one slash,
// host segment is alnum + dots, path segments are alnum + dashes/dots/underscores/slashes.
// We enforce at most 200 chars and reject characters that would need URL-escaping.
const MODULE_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,199}$/;

// Go semver tags include "v" prefix; we accept the GOPROXY canonical form.
const VERSION_TAG = /^v[0-9]+(\.[0-9]+)*([-+][A-Za-z0-9._-]+)?$/;

export function requireModulePath(value) {
    const s = String(value ?? '').trim();
    if (!s) {
        throw new ArgumentError(
            'goproxy module path is required (e.g. "github.com/gin-gonic/gin", "golang.org/x/net")',
            'Use the canonical module path that appears in `go.mod`.',
        );
    }
    if (!MODULE_PATH.test(s) || !s.includes('/')) {
        throw new ArgumentError(
            `goproxy module path "${value}" is not a recognised Go module path`,
            'Module paths look like "github.com/<org>/<repo>" or "golang.org/x/<name>".',
        );
    }
    return s;
}

export function requireVersionTag(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('goproxy --version cannot be empty');
    if (!VERSION_TAG.test(s)) {
        throw new ArgumentError(
            `goproxy --version "${value}" is not a valid Go semver tag`,
            'Use the GOPROXY canonical form like "v1.2.3" or "v0.0.0-20240101010101-abcdef012345".',
        );
    }
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`goproxy ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`goproxy ${label} must be <= ${maxValue}`);
    }
    return n;
}

async function rawFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that proxy.golang.org is reachable from this network.',
        );
    }
    if (resp.status === 404 || resp.status === 410) {
        throw new EmptyResultError(label, `proxy.golang.org returned ${resp.status} for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(`${label} returned HTTP 429 (rate limited)`);
    }
    if (!resp.ok) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}`);
    }
    return resp;
}

export async function goproxyJson(url, label) {
    const resp = await rawFetch(url, label);
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    return body;
}

export async function goproxyText(url, label) {
    const resp = await rawFetch(url, label);
    return resp.text();
}

// Sort version tags by their numeric components, newest first. Pre-release tags
// (anything after "-" that isn't a pure number) sort lower than the matching
// release. Returns a new sorted array; non-tag inputs are dropped.
export function sortVersionsDescending(versions) {
    return versions
        .filter((v) => typeof v === 'string' && VERSION_TAG.test(v))
        .map((v) => ({ v, parts: parseSemver(v) }))
        .sort((a, b) => compareParts(b.parts, a.parts))
        .map((entry) => entry.v);
}

function parseSemver(tag) {
    // Strip leading "v"; split into <numbers>(-<pre>)?(+<build>)?
    const stripped = tag.replace(/^v/, '');
    const plusIdx = stripped.indexOf('+');
    const noBuild = plusIdx >= 0 ? stripped.slice(0, plusIdx) : stripped;
    const dashIdx = noBuild.indexOf('-');
    const head = dashIdx >= 0 ? noBuild.slice(0, dashIdx) : noBuild;
    const pre = dashIdx >= 0 ? noBuild.slice(dashIdx + 1) : '';
    const numbers = head.split('.').map((s) => Number.parseInt(s, 10)).map((n) => Number.isFinite(n) ? n : 0);
    return { numbers, pre };
}

function compareParts(a, b) {
    const len = Math.max(a.numbers.length, b.numbers.length);
    for (let i = 0; i < len; i += 1) {
        const ai = a.numbers[i] ?? 0;
        const bi = b.numbers[i] ?? 0;
        if (ai !== bi) return ai - bi;
    }
    // No pre-release sorts higher than has pre-release.
    if (a.pre === '' && b.pre !== '') return 1;
    if (a.pre !== '' && b.pre === '') return -1;
    if (a.pre === b.pre) return 0;
    return comparePrerelease(a.pre, b.pre);
}

function comparePrerelease(a, b) {
    const aParts = a.split('.');
    const bParts = b.split('.');
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i += 1) {
        const ai = aParts[i];
        const bi = bParts[i];
        if (ai == null) return -1;
        if (bi == null) return 1;
        const aNum = /^\d+$/.test(ai);
        const bNum = /^\d+$/.test(bi);
        if (aNum && bNum) {
            const diff = Number(ai) - Number(bi);
            if (diff !== 0) return diff;
            continue;
        }
        if (aNum !== bNum) return aNum ? -1 : 1;
        if (ai !== bi) return ai < bi ? -1 : 1;
    }
    return 0;
}

// Normalise GOPROXY ISO-Z timestamps to second precision (no fractional ms).
export function trimDate(value) {
    const s = String(value ?? '').trim();
    if (!s) return null;
    const noFrac = s.replace(/\.\d+/, '');
    return noFrac.endsWith('Z') ? noFrac : (s.length >= 10 ? s.slice(0, 10) : null);
}
