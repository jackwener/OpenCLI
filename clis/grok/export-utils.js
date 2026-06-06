import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

export const GROK_CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function unwrapEvaluateResult(value) {
    if (
        value
        && typeof value === 'object'
        && !Array.isArray(value)
        && Object.hasOwn(value, 'session')
        && Object.hasOwn(value, 'data')
    ) {
        return value.data;
    }
    return value;
}

export function requireObjectEvaluateResult(value, label) {
    const payload = unwrapEvaluateResult(value);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new CommandExecutionError(`${label} returned a malformed payload`, 'Expected an object payload from the Grok page.');
    }
    return payload;
}

export function requireBooleanEvaluateResult(value, label) {
    const payload = unwrapEvaluateResult(value);
    if (typeof payload !== 'boolean') {
        throw new CommandExecutionError(`${label} returned a malformed payload`, 'Expected a boolean payload from the Grok page.');
    }
    return payload;
}

function normalizeGrokUrl(value, id, makeError) {
    const fallback = `https://grok.com/c/${id}`;
    const raw = value == null || value === '' ? fallback : String(value);
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        throw makeError(`invalid url for conversation ${id}`);
    }
    const host = parsed.hostname.toLowerCase();
    const match = parsed.pathname.match(/^\/c\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
    if (parsed.protocol !== 'https:' || (host !== 'grok.com' && !host.endsWith('.grok.com')) || !match) {
        throw makeError(`invalid url for conversation ${id}`);
    }
    if (match[1].toLowerCase() !== id) {
        throw makeError(`url id mismatch for conversation ${id}`);
    }
    return `https://grok.com/c/${id}`;
}

export function normalizeConversationRows(rows, label) {
    if (!Array.isArray(rows)) {
        throw new CommandExecutionError(`${label} returned malformed rows`, 'Expected rows to be an array.');
    }
    return rows.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new CommandExecutionError(`${label} returned a malformed row`, `Row ${index + 1} is not an object.`);
        }
        const id = String(row.id || '').trim().toLowerCase();
        if (!GROK_CONVERSATION_ID_RE.test(id)) {
            throw new CommandExecutionError(`${label} returned a malformed row`, `Row ${index + 1} is missing a valid Grok conversation id.`);
        }
        return {
            id,
            title: row.title == null || row.title === '' ? '' : String(row.title),
            date: row.date == null || row.date === '' ? '' : String(row.date),
            url: normalizeGrokUrl(row.url, id, (reason) => new CommandExecutionError(`${label} returned a malformed row`, reason)),
        };
    });
}

export function normalizeManifestRows(rows) {
    if (!Array.isArray(rows)) {
        throw new ArgumentError('manifestPath', 'must point to a JSON array exported by grok/export');
    }
    return rows.map((row, index) => {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            throw new ArgumentError('manifestPath', `row ${index + 1} must be an object`);
        }
        const id = String(row.id || '').trim().toLowerCase();
        if (!GROK_CONVERSATION_ID_RE.test(id)) {
            throw new ArgumentError('manifestPath', `row ${index + 1} is missing a valid Grok conversation id`);
        }
        return {
            id,
            title: row.title == null || row.title === '' ? '' : String(row.title),
            date: row.date == null || row.date === '' ? '' : String(row.date),
            url: normalizeGrokUrl(row.url, id, (reason) => new ArgumentError('manifestPath', `row ${index + 1}: ${reason}`)),
        };
    });
}
