import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';
import { buildWaitForStoreJs, normalizeXhsAvatar, parseXhsCount, PINIA_ACCESS_JS, requireXhsUserId, xhsProfileUrl } from './pinia-helpers.js';

const validId = '5d8f88dc0000000001005d3a';

describe('xiaohongshu pinia-helpers', () => {
    describe('parseXhsCount', () => {
        it('parses plain digits, 万 / 亿 and K / M suffixes into integers', () => {
            expect(parseXhsCount('9776')).toBe(9776);
            expect(parseXhsCount('1.2万')).toBe(12000);
            expect(parseXhsCount('3亿')).toBe(300000000);
            expect(parseXhsCount('9.8K')).toBe(9800);
            expect(parseXhsCount('1.5M')).toBe(1500000);
            expect(parseXhsCount('1,234')).toBe(1234);
            expect(parseXhsCount(42)).toBe(42);
        });

        it('returns null for anything it cannot read, never a fake 0', () => {
            expect(parseXhsCount('')).toBeNull();
            expect(parseXhsCount(undefined)).toBeNull();
            expect(parseXhsCount(null)).toBeNull();
            expect(parseXhsCount('未知')).toBeNull();
            expect(parseXhsCount(Number.NaN)).toBeNull();
        });
    });

    describe('requireXhsUserId', () => {
        it('accepts bare ids and profile URLs', () => {
            expect(requireXhsUserId(validId)).toBe(validId);
            expect(requireXhsUserId(`https://www.xiaohongshu.com/user/profile/${validId}?xsec_token=t`)).toBe(validId);
            expect(requireXhsUserId(`https://www.xiaohongshu.com/user/profile/${validId}/`)).toBe(validId);
        });

        it('rejects short ids, foreign hosts and non-profile paths', () => {
            expect(() => requireXhsUserId('')).toThrow(ArgumentError);
            expect(() => requireXhsUserId('abc')).toThrow(ArgumentError);
            expect(() => requireXhsUserId(`https://evil.example/user/profile/${validId}`)).toThrow(ArgumentError);
            expect(() => requireXhsUserId(`http://www.xiaohongshu.com/user/profile/${validId}`)).toThrow(ArgumentError);
            expect(() => requireXhsUserId(`https://www.xiaohongshu.com/explore/${validId}`)).toThrow(ArgumentError);
        });
    });

    it('normalizes avatars to https and maps empty to null', () => {
        expect(normalizeXhsAvatar('http://sns-avatar-qc.xhscdn.com/a.jpg')).toBe('https://sns-avatar-qc.xhscdn.com/a.jpg');
        expect(normalizeXhsAvatar('  ')).toBeNull();
        expect(normalizeXhsAvatar(undefined)).toBeNull();
    });

    it('builds profile urls', () => {
        expect(xhsProfileUrl(validId)).toBe(`https://www.xiaohongshu.com/user/profile/${validId}`);
        expect(xhsProfileUrl(validId, 'www.rednote.com')).toBe(`https://www.rednote.com/user/profile/${validId}`);
    });

    it('exposes a Pinia access prelude and a store wait poller that reference __vue_app__.$pinia', () => {
        expect(PINIA_ACCESS_JS).toContain('__vue_app__');
        expect(PINIA_ACCESS_JS).toContain('$pinia');
        const wait = buildWaitForStoreJs('search', 1234);
        expect(wait).toContain("__xhsStore(\"search\")");
        expect(wait).toContain('1234');
        // Must be a syntactically valid expression.
        expect(() => new Function(`return (${wait});`)).not.toThrow();
        expect(() => new Function(`${PINIA_ACCESS_JS}`)).not.toThrow();
    });
});
