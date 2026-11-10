import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getSelfUid, requireArrayEvaluateResult, requireObjectEvaluateResult, unwrapEvaluateResult } from './utils.js';

function makeUidPage(evalResults) {
    let i = 0;
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(() => Promise.resolve(evalResults[i++])),
    };
}

describe('getSelfUid (stale warm-tab recovery)', () => {
    it('returns the uid without reloading when the store already knows it', async () => {
        const page = makeUidPage(['1931632001']);
        await expect(getSelfUid(page)).resolves.toBe('1931632001');
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('reloads once and retries when a warm tab predates the login (store and config both empty)', async () => {
        // Persistent site session: the tab may still show the pre-login page,
        // whose Vue store has no uid. A single reload must bring it current.
        const page = makeUidPage([null, null, '1931632001']);
        await expect(getSelfUid(page)).resolves.toBe('1931632001');
        expect(page.goto).toHaveBeenCalledExactlyOnceWith('https://weibo.com');
        expect(page.wait).toHaveBeenCalledWith(2);
    });

    it('throws AuthRequiredError only after the reload retry also fails', async () => {
        const page = makeUidPage([null, null, null, null]);
        await expect(getSelfUid(page)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledExactlyOnceWith('https://weibo.com');
    });
});

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
