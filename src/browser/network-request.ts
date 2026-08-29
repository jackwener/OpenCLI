import { inferShape, type Shape } from './shape.js';

const REDACTED = '<redacted>';

export interface SafeNetworkRequest {
    headers?: Record<string, string>;
    body_kind?: 'empty' | 'json' | 'form' | 'opaque';
    body?: unknown;
    body_shape?: Shape;
    body_full_size?: number;
    body_truncated?: boolean;
    body_omitted?: boolean;
    redacted?: boolean;
}

export interface CapturedRequestMetadata {
    headers?: unknown;
    bodyKind?: unknown;
    bodyPreview?: unknown;
    bodyFullSize?: unknown;
    bodyTruncated?: unknown;
}

function normalizedName(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSensitiveName(name: string): boolean {
    const normalized = normalizedName(name);
    return normalized === 'authorization'
        || normalized === 'proxyauthorization'
        || normalized === 'cookie'
        || normalized === 'setcookie'
        || normalized === 'sapisid'
        || normalized === 'sid'
        || normalized === 'liat'
        || normalized === 'jsessionid'
        || normalized === 'password'
        || normalized === 'passwd'
        || normalized === 'apikey'
        || normalized === 'auth'
        || normalized === 'authentication'
        || normalized === 'credential'
        || normalized === 'credentials'
        || normalized === 'signature'
        || normalized === 'sig'
        || normalized === 'csrf'
        || normalized === 'xcsrf'
        || normalized === 'xsrf'
        || normalized === 'xxsrf'
        || normalized === 'clientsecret'
        || normalized.endsWith('authorization')
        || normalized.endsWith('cookie')
        || normalized.endsWith('apikey')
        || normalized.endsWith('password')
        || normalized.endsWith('passwd')
        || normalized.endsWith('token')
        || normalized.endsWith('secret')
        || normalized.endsWith('sessionid');
}

function isCredentialLikeValue(value: string): boolean {
    const trimmed = value.trim();
    return /^(?:bearer|basic)\s+\S+/i.test(trimmed)
        || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)
        || /^[a-f0-9]{32,}$/i.test(trimmed)
        || /^[A-Za-z0-9_-]{48,}$/.test(trimmed);
}

function sanitizeHeaders(raw: unknown): { headers?: Record<string, string>; redacted: boolean } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { redacted: false };
    const headers: Record<string, string> = {};
    let redacted = false;
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
        const stringValue = String(value);
        if (isSensitiveName(name) || isCredentialLikeValue(stringValue)) {
            headers[name] = REDACTED;
            redacted = true;
        } else {
            headers[name] = stringValue;
        }
    }
    return { ...(Object.keys(headers).length > 0 ? { headers } : {}), redacted };
}

function redactObject(value: unknown): { value: unknown; redacted: boolean } {
    if (Array.isArray(value)) {
        let redacted = false;
        const next = value.map((item) => {
            const result = redactObject(item);
            redacted ||= result.redacted;
            return result.value;
        });
        return { value: next, redacted };
    }
    if (typeof value === 'string' && isCredentialLikeValue(value)) {
        return { value: REDACTED, redacted: true };
    }
    if (!value || typeof value !== 'object') return { value, redacted: false };

    let redacted = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveName(key)) {
            next[key] = REDACTED;
            redacted = true;
            continue;
        }
        const result = redactObject(item);
        next[key] = result.value;
        redacted ||= result.redacted;
    }
    return { value: next, redacted };
}

function formBody(raw: string): { body: Record<string, string | string[]>; redacted: boolean } {
    const values = new URLSearchParams(raw);
    const body: Record<string, string | string[]> = {};
    let redacted = false;
    for (const [key, value] of values.entries()) {
        const safeValue = isSensitiveName(key) || isCredentialLikeValue(value) ? REDACTED : value;
        redacted ||= safeValue === REDACTED;
        const previous = body[key];
        if (previous === undefined) body[key] = safeValue;
        else if (Array.isArray(previous)) previous.push(safeValue);
        else body[key] = [previous, safeValue];
    }
    return { body, redacted };
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
    if (!headers) return '';
    const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
    return match?.[1] ?? '';
}

/**
 * Preserve request structure without turning `browser network` into a secret
 * dumper. Known credential fields are redacted. JSON objects and URL-encoded
 * forms remain inspectable; positional JSON and opaque bodies expose shape /
 * size only because their secret-bearing slots cannot be identified safely.
 */
export function sanitizeCapturedRequest(raw: CapturedRequestMetadata): SafeNetworkRequest | undefined {
    const sanitizedHeaders = sanitizeHeaders(raw.headers);
    const preview = typeof raw.bodyPreview === 'string' ? raw.bodyPreview : undefined;
    const fullSize = typeof raw.bodyFullSize === 'number' && Number.isFinite(raw.bodyFullSize)
        ? raw.bodyFullSize
        : preview?.length;
    const truncated = raw.bodyTruncated === true;
    const rawKind = typeof raw.bodyKind === 'string' ? raw.bodyKind : undefined;

    if (!sanitizedHeaders.headers && preview === undefined && rawKind === undefined) return undefined;

    const request: SafeNetworkRequest = {
        ...(sanitizedHeaders.headers ? { headers: sanitizedHeaders.headers } : {}),
        ...(typeof fullSize === 'number' ? { body_full_size: fullSize } : {}),
        ...(truncated ? { body_truncated: true } : {}),
        ...(sanitizedHeaders.redacted ? { redacted: true } : {}),
    };

    if (rawKind === 'empty' || preview === '') {
        request.body_kind = 'empty';
        return request;
    }
    if (preview === undefined) return request;

    const contentType = headerValue(sanitizedHeaders.headers, 'content-type').toLowerCase();
    if (!truncated) {
        try {
            const parsed = JSON.parse(preview) as unknown;
            request.body_kind = 'json';
            request.body_shape = inferShape(parsed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                const sanitized = redactObject(parsed);
                request.body = sanitized.value;
                if (sanitized.redacted) request.redacted = true;
            } else {
                request.body_omitted = true;
            }
            return request;
        } catch {
            // Non-JSON request; inspect content type below.
        }

        if (contentType.includes('application/x-www-form-urlencoded')) {
            const sanitized = formBody(preview);
            request.body_kind = 'form';
            request.body = sanitized.body;
            request.body_shape = inferShape(sanitized.body);
            if (sanitized.redacted) request.redacted = true;
            return request;
        }
    }

    request.body_kind = 'opaque';
    request.body_shape = inferShape(preview);
    request.body_omitted = true;
    return request;
}

/** Redact credential-shaped query parameters while preserving route identity. */
export function sanitizeCapturedUrl(rawUrl: string): string {
    try {
        const url = new URL(rawUrl);
        let changed = false;
        for (const key of [...url.searchParams.keys()]) {
            const value = url.searchParams.get(key) ?? '';
            if (isSensitiveName(key) || isCredentialLikeValue(value)) {
                url.searchParams.set(key, REDACTED);
                changed = true;
            }
        }
        return changed ? url.toString() : rawUrl;
    } catch {
        return rawUrl;
    }
}
