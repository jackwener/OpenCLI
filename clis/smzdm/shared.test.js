import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { parseLimit, resolveDealUrl } from './shared.js';

describe('smzdm/shared resolveDealUrl', () => {
    it('expands a bare numeric id to a canonical detail URL', () => {
        expect(resolveDealUrl('174854494')).toBe('https://www.smzdm.com/p/174854494/');
    });

    it('resolves a relative /p/ path against www.smzdm.com', () => {
        expect(resolveDealUrl('/p/123/')).toBe('https://www.smzdm.com/p/123/');
    });

    it('accepts an alphanumeric-slug post URL on an allowed host', () => {
        expect(resolveDealUrl('https://post.smzdm.com/p/aggrg8kw/')).toBe('https://post.smzdm.com/p/aggrg8kw/');
    });

    it('rejects off-domain URLs', () => {
        expect(() => resolveDealUrl('https://evil.example/p/1/')).toThrow(ArgumentError);
    });

    it('rejects non-https URLs', () => {
        expect(() => resolveDealUrl('http://www.smzdm.com/p/1/')).toThrow(ArgumentError);
    });

    it('rejects empty input', () => {
        expect(() => resolveDealUrl('')).toThrow(ArgumentError);
        expect(() => resolveDealUrl(null)).toThrow(ArgumentError);
    });
});

describe('smzdm/shared parseLimit', () => {
    it('defaults to 20 when unset', () => {
        expect(parseLimit(undefined)).toBe(20);
    });

    it('accepts numeric strings within range', () => {
        expect(parseLimit('50')).toBe(50);
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(100)).toBe(100);
    });

    it('rejects out-of-range and non-integer input', () => {
        expect(() => parseLimit(0)).toThrow(ArgumentError);
        expect(() => parseLimit(101)).toThrow(ArgumentError);
        expect(() => parseLimit('1e2')).toThrow(ArgumentError);
        expect(() => parseLimit('abc')).toThrow(ArgumentError);
    });
});
