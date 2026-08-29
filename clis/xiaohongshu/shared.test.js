import { describe, expect, it } from 'vitest';
import { unwrapEvaluateResult } from './shared.js';

describe('unwrapEvaluateResult (browser-bridge envelope normalization)', () => {
    it('returns non-envelope arrays by identity', () => {
        const arr = [{ id: '1' }];
        expect(unwrapEvaluateResult(arr)).toBe(arr);
    });
    it('unwraps the { session, data } envelope by identity', () => {
        const data = { ok: true };
        const env = { session: 'site:xiaohongshu', data };
        expect(unwrapEvaluateResult(env)).toBe(data);
    });
    it('unwraps scalar data payloads', () => {
        expect(unwrapEvaluateResult({ session: 'site:xiaohongshu:abc', data: 'login_wall' })).toBe('login_wall');
    });
    it('passes through plain objects without both envelope keys', () => {
        const obj = { session: 'only-session' };
        expect(unwrapEvaluateResult(obj)).toBe(obj);
        const dataOnly = { data: [1] };
        expect(unwrapEvaluateResult(dataOnly)).toBe(dataOnly);
    });
    it('passes through raw JSON primitives', () => {
        expect(unwrapEvaluateResult(null)).toBe(null);
        expect(unwrapEvaluateResult(42)).toBe(42);
    });
});
