import { describe, expect, it, vi } from 'vitest';
import { navigateFresh, unwrapEvaluateResult } from './shared.js';

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

describe('navigateFresh (warm persistent tab must not serve a stale document)', () => {
    const url = 'https://www.xiaohongshu.com/explore';

    function makePage(currentUrl) {
        return {
            getCurrentUrl: vi.fn().mockResolvedValue(currentUrl),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(undefined),
        };
    }

    it('forces a real reload when the tab already sits at the target URL', async () => {
        // The extension fast-paths a goto to the current URL without loading
        // anything — feed would read the same Pinia store forever.
        const page = makePage(url);
        await navigateFresh(page, url);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).toHaveBeenCalledWith('location.reload()');
    });

    it('navigates normally when the tab is elsewhere', async () => {
        const page = makePage('https://www.xiaohongshu.com/user/profile/abc');
        await navigateFresh(page, url);
        expect(page.goto).toHaveBeenCalledWith(url);
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('navigates when getCurrentUrl is unavailable or rejects', async () => {
        const bare = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn() };
        await navigateFresh(bare, url);
        expect(bare.goto).toHaveBeenCalledWith(url);

        const failing = makePage(null);
        failing.getCurrentUrl = vi.fn().mockRejectedValue(new Error('detached'));
        await navigateFresh(failing, url);
        expect(failing.goto).toHaveBeenCalledWith(url);
    });

    it('falls back to goto when the in-place reload evaluate rejects', async () => {
        const page = makePage(url);
        page.evaluate = vi.fn().mockRejectedValue(new Error('context destroyed'));
        await navigateFresh(page, url);
        expect(page.goto).toHaveBeenCalledWith(url);
    });
});
