// Shared helpers for the Maven Central (search.maven.org) adapter.
//
// Hits the public, unauthenticated `search.maven.org/solrsearch/select` Solr
// endpoint that powers the Maven Central search UI. No auth required for
// read-only queries.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const MAVEN_BASE = 'https://search.maven.org/solrsearch/select';
export const MAVEN_REPO_BASE = 'https://repo1.maven.org/maven2';
const UA = 'opencli-maven-adapter (+https://github.com/jackwener/opencli)';

// Maven groupId / artifactId tokens — Java-package-ish (letters / digits /
// `_-.`), 1-200 chars; reverse-DNS dots are allowed in groupId.
const COORD_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function requireString(value, label) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError(`maven ${label} cannot be empty`);
    return s;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`maven ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`maven ${label} must be <= ${maxValue}`);
    }
    return n;
}

/**
 * Parse a Maven coordinate `groupId:artifactId[:version]` into segments.
 * groupId / artifactId are required; version is optional.
 */
export function requireCoord(value) {
    const raw = String(value ?? '').trim();
    if (!raw) {
        throw new ArgumentError('maven coordinate is required (e.g. "com.fasterxml.jackson.core:jackson-databind")');
    }
    const parts = raw.split(':');
    if (parts.length < 2 || parts.length > 3) {
        throw new ArgumentError(
            `maven coordinate "${value}" must be "groupId:artifactId" or "groupId:artifactId:version"`,
        );
    }
    const [groupId, artifactId, version] = parts;
    if (!groupId || !artifactId) {
        throw new ArgumentError(`maven coordinate "${value}" is missing groupId or artifactId`);
    }
    if (groupId.length > 200 || !COORD_TOKEN.test(groupId)) {
        throw new ArgumentError(
            `maven groupId "${groupId}" is not a valid token`,
            'Use letters / digits / "_-." (max 200 chars), starting with a letter or digit.',
        );
    }
    if (artifactId.length > 200 || !COORD_TOKEN.test(artifactId)) {
        throw new ArgumentError(
            `maven artifactId "${artifactId}" is not a valid token`,
            'Use letters / digits / "_-." (max 200 chars), starting with a letter or digit.',
        );
    }
    if (version != null && version.length > 200) {
        throw new ArgumentError(`maven version "${version}" is too long (max 200 chars).`);
    }
    return { groupId, artifactId, version: version ?? null };
}

export async function mavenFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that search.maven.org is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `Maven Central returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'Maven Central throttles bursts; wait a few seconds and retry.',
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

/** Convert epoch-ms (Maven Solr `timestamp`) to ISO-8601 UTC. Returns null for falsy/invalid. */
export function epochMsToIso(value) {
    if (value == null) return null;
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n).toISOString().replace(/\.\d+Z$/, 'Z');
}
