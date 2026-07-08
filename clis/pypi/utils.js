// Shared helpers for the pypi adapters that hit the PyPI public JSON API
// (pypi.org/pypi/<pkg>/json) and pypistats.org for download stats.
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const PYPI_BASE = 'https://pypi.org';
export const PYPISTATS_BASE = 'https://pypistats.org';
const UA = 'opencli-pypi-adapter (+https://github.com/jackwener/opencli)';

// PEP 508 / PEP 426 normalized name: letters, digits, "._-", with leading-letter rule relaxed by PyPI.
const PKG_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export function requirePackageName(value) {
    const s = String(value ?? '').trim();
    if (!s) throw new ArgumentError('pypi package name is required (e.g. "requests", "pandas")');
    if (!PKG_NAME.test(s)) {
        throw new ArgumentError(
            `pypi package name "${value}" is not a valid distribution name`,
            'PyPI accepts ASCII letters / digits / "._-" with no leading or trailing separator.',
        );
    }
    return s;
}

export async function pypiFetch(url, label) {
    let resp;
    try {
        resp = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    }
    catch (err) {
        throw new CommandExecutionError(
            `${label} request failed: ${err?.message ?? err}`,
            'Check that pypi.org / pypistats.org are reachable from this network.',
        );
    }
    if (resp.status === 404) {
        throw new EmptyResultError(label, `PyPI returned 404 for ${url}.`);
    }
    if (resp.status === 429) {
        throw new CommandExecutionError(
            `${label} returned HTTP 429 (rate limited)`,
            'PyPI throttles unauthenticated bursts; wait a few seconds and retry.',
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
