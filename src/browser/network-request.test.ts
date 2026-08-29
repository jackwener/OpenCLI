import { describe, expect, it } from 'vitest';
import { sanitizeCapturedRequest, sanitizeCapturedUrl } from './network-request.js';

describe('network request sanitization', () => {
    it('redacts sensitive headers and nested JSON fields while preserving shape', () => {
        const request = sanitizeCapturedRequest({
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer live-secret',
                Cookie: 'sid=live-cookie',
                'X-CSRF': 'bare-header-csrf',
                'X-Trace-Id': 'trace-1',
                'X-Runtime-Id': 'a'.repeat(48),
            },
            bodyKind: 'string',
            bodyPreview: JSON.stringify({
                query: 'timeline',
                variables: { cursor: 'next', csrfToken: 'live-csrf', csrf: 'bare-body-csrf' },
            }),
            bodyFullSize: 91,
        });

        expect(request).toMatchObject({
            headers: {
                'Content-Type': 'application/json',
                Authorization: '<redacted>',
                Cookie: '<redacted>',
                'X-CSRF': '<redacted>',
                'X-Trace-Id': 'trace-1',
                'X-Runtime-Id': '<redacted>',
            },
            body_kind: 'json',
            body: {
                query: 'timeline',
                variables: { cursor: 'next', csrfToken: '<redacted>', csrf: '<redacted>' },
            },
            body_full_size: 91,
            redacted: true,
        });
        expect(request?.body_shape?.['$.variables.csrfToken']).toBe('string');
        expect(JSON.stringify(request)).not.toContain('live-secret');
        expect(JSON.stringify(request)).not.toContain('live-cookie');
        expect(JSON.stringify(request)).not.toContain('live-csrf');
        expect(JSON.stringify(request)).not.toContain('bare-header-csrf');
        expect(JSON.stringify(request)).not.toContain('bare-body-csrf');
    });

    it('redacts form credentials and preserves repeated safe fields', () => {
        const request = sanitizeCapturedRequest({
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            bodyKind: 'string',
            bodyPreview: 'q=opencli&tag=one&tag=two&access_token=secret&xsrf=bare-form-xsrf',
        });

        expect(request?.body_kind).toBe('form');
        expect(request?.body).toEqual({
            q: 'opencli',
            tag: ['one', 'two'],
            access_token: '<redacted>',
            xsrf: '<redacted>',
        });
        expect(request?.redacted).toBe(true);
    });

    it('omits positional and truncated bodies but keeps their shape and size', () => {
        const positional = sanitizeCapturedRequest({
            bodyKind: 'string',
            bodyPreview: JSON.stringify(['opaque-runtime-token', { cursor: 'next' }]),
        });
        expect(positional?.body_kind).toBe('json');
        expect(positional?.body_omitted).toBe(true);
        expect(positional?.body_shape?.['$']).toBe('array(2)');
        expect(positional).not.toHaveProperty('body');

        const truncated = sanitizeCapturedRequest({
            bodyKind: 'string',
            bodyPreview: '{"partial":',
            bodyFullSize: 50_000,
            bodyTruncated: true,
        });
        expect(truncated).toMatchObject({
            body_kind: 'opaque',
            body_full_size: 50_000,
            body_truncated: true,
            body_omitted: true,
        });
    });

    it('redacts credential-shaped URL query parameters', () => {
        const url = sanitizeCapturedUrl('https://api.example.test/rsc-action?page=2&csrf_token=secret&xsrf=bare-query-xsrf');
        expect(url).toContain('page=2');
        expect(url).toContain('csrf_token=%3Credacted%3E');
        expect(url).toContain('xsrf=%3Credacted%3E');
        expect(url).not.toContain('secret');
        expect(url).not.toContain('bare-query-xsrf');
    });
});
