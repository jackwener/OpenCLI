import { describe, expect, it } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { requireArrayEvaluateResult, requireObjectEvaluateResult, unwrapEvaluateResult } from './utils.js';

describe('unwrapEvaluateResult (browser-bridge envelope normalization)', () => {
    it('returns the raw array unchanged when payload is already an array', () => {
        const arr = [{ id: '1' }, { id: '2' }];
        expect(unwrapEvaluateResult(arr)).toBe(arr);
    });
    it('unwraps { session, data: [...] } envelope to the inner array', () => {
        const arr = [{ id: '1' }];
        const env = { session: 'site:weibo:abc', data: arr };
        expect(unwrapEvaluateResult(env)).toBe(arr);
    });
    it('unwraps primitive data (e.g. uid string) from Browser Bridge envelopes', () => {
        expect(unwrapEvaluateResult({ session: 'site:weibo:abc', data: '1234567890' })).toBe('1234567890');
    });
    it('unwraps null payload data so getSelfUid fallback can trigger', () => {
        expect(unwrapEvaluateResult({ session: 'site:weibo:abc', data: null })).toBe(null);
    });
    it('passes non-envelope objects through unchanged (e.g. profile result)', () => {
        const obj = { screen_name: 'alice', uid: '42' };
        expect(unwrapEvaluateResult(obj)).toBe(obj);
    });
    it('handles null and undefined safely', () => {
        expect(unwrapEvaluateResult(null)).toBe(null);
        expect(unwrapEvaluateResult(undefined)).toBe(undefined);
    });
    it('keeps malformed array/object payloads as typed command failures after unwrap', () => {
        expect(requireArrayEvaluateResult([{ id: '1' }], 'weibo feed')).toEqual([{ id: '1' }]);
        expect(() => requireArrayEvaluateResult({ error: 'API error' }, 'weibo feed')).toThrow(CommandExecutionError);
        expect(() => requireArrayEvaluateResult({ error: 'API error' }, 'weibo feed')).toThrow('weibo feed: API error');
        expect(requireObjectEvaluateResult({ uid: '42' }, 'weibo me')).toEqual({ uid: '42' });
        expect(() => requireObjectEvaluateResult([{ uid: '42' }], 'weibo me')).toThrow(CommandExecutionError);
    });
});
