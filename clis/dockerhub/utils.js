// Shared helpers for the Docker Hub adapters.
//
// Hits the public, unauthenticated `hub.docker.com/v2` REST endpoints. Anonymous
// pulls are throttled but search / metadata reads are friendly enough for
// ad-hoc CLI use. Image names follow `[<owner>/]<name>` with `library` as the
// implicit owner for Docker official images.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const HUB_BASE = 'https://hub.docker.com/v2';
const UA = 'opencli-dockerhub-adapter (+https://github.com/jackwener/opencli)';

// Docker Hub repository slugs are 2-255 chars, lowercase alphanumerics + `_.-`,
// optionally prefixed with a Docker Hub user/org of the same charset.
const SLUG = /^[a-z0-9][a-z0-9._-]*$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`dockerhub ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`dockerhub ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`dockerhub ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Split an image identifier into `{owner, name}`. Bare names use the implicit
 * `library` owner that Docker Hub uses for official images (`nginx` →
 * `library/nginx`).
 */
export function parseImage(input) {
    const raw = String(input ?? '').trim().toLowerCase();
    if (!raw) {
        throw new ArgumentError('dockerhub image name is required (e.g. "nginx", "library/nginx", "bitnami/redis")');
    }
    const slash = raw.indexOf('/');
    let owner;
    let name;
    if (slash >= 0) {
        owner = raw.slice(0, slash);
        name = raw.slice(slash + 1);
    }
    else {
        owner = 'library';
        name = raw;
    }
    if (!SLUG.test(owner) || !SLUG.test(name)) {
        throw new ArgumentError(
            `dockerhub image "${input}" is not a valid repository slug`,
            'Use lowercase letters / digits / "._-", optionally prefixed with "<owner>/".',
        );
    }
    if (name.length < 2 || name.length > 255) {
        throw new ArgumentError(
            `dockerhub image "${input}" name must be 2-255 chars`,
        );
    }
    return { owner, name };
}

export async function hubFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that hub.docker.com is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Docker Hub returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Docker Hub throttles anonymous traffic; wait a few seconds and retry.',
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
