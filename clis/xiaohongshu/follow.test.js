import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';

import { __test__ } from './follow.js';
import './unfollow.js';

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const r of evaluateResults) evaluate.mockResolvedValueOnce(r);
    evaluate.mockResolvedValue(undefined);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
    };
}

describe('xiaohongshu follow', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/follow');
    const validId = '5d8f88dc0000000001005d3a';
    const profileUrl = `https://www.xiaohongshu.com/user/profile/${validId}`;
    const notFollowing = { ok: true, fstatus: 'none', hydrated: true };
    const following = { ok: true, fstatus: 'follows', hydrated: true };

    it('trusts the fstatus the follow API returns without re-reading the page', async () => {
        const page = makePage([
            profileUrl,                                                    // location.href
            notFollowing,                                                  // status before
            { ok: true, state: 'followed', fstatus: 'follows', response: {} },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result).toEqual([{
            ok: true,
            user_id: validId,
            already_following: false,
            status: 'followed',
            verified: true,
            url: profileUrl,
        }]);
        // No verification round-trip needed when the API already answered.
        expect(page.goto).toHaveBeenCalledTimes(1);
        const followScript = String(page.evaluate.mock.calls[2][0]);
        expect(followScript).toContain('store.toFollow({ targetUserId })');
        expect(followScript).toContain(JSON.stringify(validId));
    });

    it('re-reads through /explore when the API response carries no fstatus', async () => {
        const page = makePage([
            profileUrl,
            notFollowing,
            { ok: true, state: 'followed', response: {} },  // no fstatus
            following,                                      // fresh read after the bounce
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result[0]).toMatchObject({ ok: true, status: 'followed', verified: true });
        // A same-URL goto is a soft nav in this SPA, so the profile is only
        // re-fetched after leaving for /explore first.
        expect(page.goto.mock.calls.map((c) => c[0])).toEqual([
            profileUrl,
            'https://www.xiaohongshu.com/explore',
            profileUrl,
        ]);
    });

    it('returns already_following without issuing a write when fstatus is follows / both', async () => {
        for (const fstatus of ['follows', 'both']) {
            const page = makePage([profileUrl, { ok: true, fstatus, hydrated: true }]);
            const result = await getCommand().func(page, { 'user-id': validId });
            expect(result).toEqual([{
                ok: true,
                user_id: validId,
                already_following: true,
                status: 'already-following',
                verified: true,
                url: profileUrl,
            }]);
            // href + status read only — no follow action, no reload.
            expect(page.evaluate).toHaveBeenCalledTimes(2);
            expect(page.goto).toHaveBeenCalledTimes(1);
        }
    });

    it('waits for the store to hydrate before reading the relation', async () => {
        const page = makePage([
            profileUrl,
            { ok: true, fstatus: null, hydrated: false },
            { ok: true, fstatus: null, hydrated: false },
            following,
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result[0].already_following).toBe(true);
        expect(page.wait).toHaveBeenCalledTimes(3); // settle + 2 hydration retries
        expect(result[0].verified).toBe(true);
    });

    it('accepts a full profile URL and extracts the user id', async () => {
        const page = makePage([profileUrl, following]);
        await getCommand().func(page, {
            'user-id': `${profileUrl}?xsec_token=abc&xsec_source=pc`,
        });
        expect(page.goto).toHaveBeenCalledWith(profileUrl);
    });

    it('unwraps browser bridge envelopes at every evaluate boundary', async () => {
        const page = makePage([
            { session: 's', data: profileUrl },
            { session: 's', data: notFollowing },
            { session: 's', data: { ok: true, state: 'followed', fstatus: 'follows' } },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result[0].status).toBe('followed');
    });

    it('rejects malformed user ids before navigation', async () => {
        const page = makePage();
        await expect(getCommand().func(page, { 'user-id': '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(getCommand().func(page, { 'user-id': 'short' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequiredError when xhs redirects to /login', async () => {
        const page = makePage([
            'https://www.xiaohongshu.com/login?redirectPath=/user/profile/' + validId,
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws AuthRequiredError when the store reports a login wall', async () => {
        const page = makePage([profileUrl, { ok: false, reason: 'login_wall' }]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError when navigation lands on a different profile', async () => {
        const page = makePage([
            'https://www.xiaohongshu.com/user/profile/5d8f88dc0000000001005d4b',
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected profile/);
    });

    it('throws CommandExecutionError when navigation lands on a non-Xiaohongshu host', async () => {
        const page = makePage([`https://evil.example/user/profile/${validId}`]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected Xiaohongshu profile host/);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('surfaces the store being unavailable as a CommandExecutionError', async () => {
        const page = makePage([profileUrl, { ok: false, reason: 'store_unavailable' }]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/user store unavailable \(store_unavailable\)/);
    });

    it('surfaces follow API errors with code and message', async () => {
        const page = makePage([
            profileUrl,
            notFollowing,
            { ok: false, state: 'failed', reason: 'api_error', code: 300011, message: '当前账号存在异常' },
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/当前账号存在异常 \(code 300011\)/);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('reports an accepted follow as ok:true with verified:false when the read-back stays stale', async () => {
        // Regression: a follow that had actually landed was reported as a
        // failure because the SPA kept serving the pre-follow profile. This
        // command is not idempotent, so a retry would double-follow.
        const page = makePage([
            profileUrl,
            notFollowing,
            { ok: true, state: 'followed' },
            ...Array.from({ length: 12 }, () => notFollowing),
        ]);
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
        try {
            const result = await getCommand().func(page, { 'user-id': validId });
            expect(result[0]).toMatchObject({
                ok: true,
                already_following: false,
                status: 'followed-unverified',
                verified: false,
            });
            expect(stderr.mock.calls[0][0]).toBe('FOLLOW_UNVERIFIED\n');
        } finally {
            stderr.mockRestore();
        }
    });

    it('throws CommandExecutionError for malformed evaluate payloads', async () => {
        const page1 = makePage([{ not: 'a string' }]);
        await expect(getCommand().func(page1, { 'user-id': validId })).rejects.toThrowError(/malformed current-url payload/);

        const page2 = makePage([profileUrl, { fstatus: 'none' }]);
        await expect(getCommand().func(page2, { 'user-id': validId })).rejects.toThrowError(/malformed follow-status payload/);

        const page3 = makePage([profileUrl, notFollowing, { ok: 'yes', state: 'followed' }]);
        await expect(getCommand().func(page3, { 'user-id': validId })).rejects.toThrowError(/malformed follow-action payload/);
    });

    describe('__test__.assertUserId', () => {
        it('normalizes raw user ids and URL forms', () => {
            expect(__test__.assertUserId(validId)).toBe(validId);
            expect(__test__.assertUserId(profileUrl)).toBe(validId);
            expect(__test__.assertUserId(`${profileUrl}?xsec_token=t`)).toBe(validId);
            expect(__test__.assertUserId(`${profileUrl}/`)).toBe(validId);
        });
        it('rejects too-short or non-alphanumeric ids', () => {
            expect(() => __test__.assertUserId('')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId('abc')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId('!!!')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId(`https://evil.example/user/profile/${validId}`)).toThrow(ArgumentError);
            expect(() => __test__.assertUserId(`${profileUrl}/note123`)).toThrow(ArgumentError);
        });
    });

    describe('injected scripts', () => {
        it('read the relation and call toFollow through the Pinia user store', () => {
            const status = __test__.buildReadStatusScript();
            expect(status).toContain("__xhsStore('user')");
            expect(status).toContain('fstatus');
            const follow = __test__.buildFollowScript(validId);
            expect(follow).toContain('__vue_app__');
            expect(follow).toContain('$pinia');
            expect(follow).toContain('toFollow');
        });
    });
});

describe('xiaohongshu unfollow', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/unfollow');
    const validId = '5d8f88dc0000000001005d3a';

    it('returns unfollowed when click, confirm, and state verification succeed', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'unfollow-clicked' },
            { ok: true },
            { ok: true },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result).toEqual([{
            status: 'unfollowed',
            user_id: validId,
            url: `https://www.xiaohongshu.com/user/profile/${validId}`,
        }]);
        expect(page.goto).toHaveBeenCalledWith(`https://www.xiaohongshu.com/user/profile/${validId}`);
    });

    it('returns not-following without modal confirmation when already unfollowed', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'not-following' },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result[0].status).toBe('not-following');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('throws AuthRequiredError when xhs redirects unfollow to /login', async () => {
        const page = makePage([
            'https://www.xiaohongshu.com/login?redirectPath=/user/profile/' + validId,
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError when unfollow navigation lands on a different profile', async () => {
        const page = makePage([
            'https://www.xiaohongshu.com/user/profile/5d8f88dc0000000001005d4b',
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected profile/);
    });

    it('throws CommandExecutionError when unfollow navigation lands on a non-Xiaohongshu host', async () => {
        const page = makePage([
            `https://evil.example/user/profile/${validId}`,
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected Xiaohongshu profile host/);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('throws CommandExecutionError when modal confirmation is missing', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'unfollow-clicked' },
            { ok: false, kind: 'no_modal' },
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/confirmation modal/);
    });

    it('throws CommandExecutionError when final unfollow verification fails', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'unfollow-clicked' },
            { ok: true },
            { ok: false, reason: 'still following' },
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/still following/);
    });
});
