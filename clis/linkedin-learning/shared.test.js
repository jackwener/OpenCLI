import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { expectRejectsWithMessage, makePage } from './test-helpers.js';
import {
    buildFetchScript,
    fetchLinkedInLearningApi,
    normalizeWhitespace,
    parseLimit,
    unwrapEvaluateResult,
} from './shared.js';

describe('linkedin-learning shared helpers', () => {
    it('normalizes whitespace consistently', () => {
        expect(normalizeWhitespace('  A\tB\nC  ')).toBe('A B C');
        expect(normalizeWhitespace(null)).toBe('');
    });

    it('validates --limit without silent clamping', () => {
        expect(parseLimit(undefined)).toBe(10);
        expect(parseLimit(null)).toBe(10);
        expect(parseLimit('')).toBe(10);
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(50)).toBe(50);
        expect(() => parseLimit(0)).toThrow(ArgumentError);
        expect(() => parseLimit(51)).toThrow(ArgumentError);
        expect(() => parseLimit('abc')).toThrow(ArgumentError);
        expect(() => parseLimit(1.5)).toThrow(ArgumentError);
    });

    it('unwraps bridge evaluate envelopes', () => {
        expect(unwrapEvaluateResult({ data: { json: true }, session: { id: 's' } })).toEqual({ json: true });
        expect(unwrapEvaluateResult({ json: true })).toEqual({ json: true });
    });

    it('escapes the URL and csrf into the fetch script as literal strings', () => {
        const script = buildFetchScript('https://www.linkedin.com/learning-api/searchV2?keywords=AI', 'csrf-token-value');
        expect(script).toContain('"https://www.linkedin.com/learning-api/searchV2?keywords=AI"');
        expect(script).toContain('"csrf-token-value"');
        expect(script).toContain("'x-restli-protocol-version': '2.0.0'");
        expect(script).toContain('authRequired: true');
    });

    it('navigates to learning home and strips quoted JSESSIONID before fetch', async () => {
        const page = makePage({ evaluateResult: { json: { ok: true } } });
        const result = await fetchLinkedInLearningApi(page, 'https://www.linkedin.com/learning-api/example');
        expect(result).toEqual({ json: { ok: true } });
        expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/learning/');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://www.linkedin.com' });
        expect(page.evaluate.mock.calls[0][0]).toContain('"ajax:abc"');
    });

    it('throws the shared exact message when JSESSIONID cookie is missing', async () => {
        const page = makePage({ cookies: [], evaluateResult: { json: { elements: [] } } });
        await expectRejectsWithMessage(
            fetchLinkedInLearningApi(page, 'https://www.linkedin.com/learning-api/example'),
            AuthRequiredError,
            'LinkedIn JSESSIONID cookie not found. Please sign in to LinkedIn in the browser.'
        );
    });

    it('throws the shared exact message when the fetch returns 401 or 403', async () => {
        const page401 = makePage({ evaluateResult: { authRequired: true, status: 401 } });
        await expectRejectsWithMessage(
            fetchLinkedInLearningApi(page401, 'https://www.linkedin.com/learning-api/example'),
            AuthRequiredError,
            'LinkedIn Learning auth failed (HTTP 401).'
        );

        const page403 = makePage({ evaluateResult: { authRequired: true, status: 403 } });
        await expectRejectsWithMessage(
            fetchLinkedInLearningApi(page403, 'https://www.linkedin.com/learning-api/example'),
            AuthRequiredError,
            'LinkedIn Learning auth failed (HTTP 403).'
        );
    });
});
