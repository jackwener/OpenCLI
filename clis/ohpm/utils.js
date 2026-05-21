import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const OHPM_BASE = 'https://ohpm.openharmony.cn';
export const OHPM_API = `${OHPM_BASE}/ohpmweb/registry/oh-package/openapi`;
const UA = 'opencli-ohpm-adapter (+https://github.com/jackwener/opencli)';
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function dateFromMs(value) {
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms <= 0) return '';
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

export function requireString(value, label) {
    const text = normalizeText(value);
    if (!text) throw new ArgumentError(`ohpm ${label} cannot be empty`);
    return text;
}

export function requirePackageName(value) {
    const name = normalizeText(value);
    if (!name) throw new ArgumentError('ohpm package name is required (e.g. "@ohos/axios")');
    if (name.length > 214) {
        throw new ArgumentError(`ohpm package name "${value}" is too long (max 214 chars)`);
    }
    if (!PACKAGE_NAME.test(name)) {
        throw new ArgumentError(
            `ohpm package name "${value}" is not a valid package name`,
            'Names are 1-214 chars of letters / digits / "-._" (scoped form: "@scope/name").',
        );
    }
    return name;
}

export function requireBoundedInt(value, defaultValue, maxValue, label = 'limit') {
    const raw = value ?? defaultValue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
        throw new ArgumentError(`ohpm ${label} must be a positive integer`);
    }
    if (n > maxValue) {
        throw new ArgumentError(`ohpm ${label} must be <= ${maxValue}`);
    }
    return n;
}

export function requireSort(value) {
    const sort = normalizeText(value || 'relevancy');
    const aliases = {
        relevance: 'relevancy',
        relevant: 'relevancy',
        popular: 'likes',
        popularity: 'likes',
        like: 'likes',
        newest: 'latest',
        recent: 'latest',
    };
    const normalized = aliases[sort] || sort;
    if (!['relevancy', 'likes', 'latest'].includes(normalized)) {
        throw new ArgumentError(
            `ohpm sort must be one of relevancy, likes, latest; got "${value}"`,
            'The OHPM public API currently rejects other sort keys.',
        );
    }
    return normalized;
}

export function packageUrl(name) {
    return `${OHPM_BASE}/#/cn/detail/${encodeURIComponent(name)}`;
}

export async function ohpmFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that ohpm.openharmony.cn is reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `OHPM returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'OHPM throttles bursts; wait a few seconds and retry.',
        );
    }
    let body;
    try {
        body = await resp.json();
    }
    catch (err) {
        throw new CommandExecutionError(`${label} returned malformed JSON: ${err?.message ?? err}`);
    }
    if (!resp.ok || body?.code && body.code !== 200) {
        throw new CommandExecutionError(`${label} returned HTTP ${resp.status}: ${body?.message ?? body?.code ?? 'unknown error'}`);
    }
    return body;
}
