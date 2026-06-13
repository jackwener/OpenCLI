import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

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

    it('returns followed when the follow click and state flip both succeed', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'followed' },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result).toEqual([{
            status: 'followed',
            user_id: validId,
            url: `https://www.xiaohongshu.com/user/profile/${validId}`,
        }]);
        expect(page.goto).toHaveBeenCalledWith(`https://www.xiaohongshu.com/user/profile/${validId}`);
    });

    it('returns already-following when the profile shows 已关注 on entry', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'already-following' },
        ]);
        const result = await getCommand().func(page, { 'user-id': validId });
        expect(result[0].status).toBe('already-following');
    });

    it('accepts a full profile URL and extracts the user id', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: true, state: 'followed' },
        ]);
        await getCommand().func(page, {
            'user-id': `https://www.xiaohongshu.com/user/profile/${validId}?xsec_token=abc&xsec_source=pc`,
        });
        expect(page.goto).toHaveBeenCalledWith(`https://www.xiaohongshu.com/user/profile/${validId}`);
    });

    it('unwraps browser bridge envelopes at every evaluate boundary', async () => {
        const page = makePage([
            { session: 's', data: `https://www.xiaohongshu.com/user/profile/${validId}` },
            { session: 's', data: { ok: true, state: 'followed' } },
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

    it('throws CommandExecutionError when navigation lands on a different profile', async () => {
        const page = makePage([
            'https://www.xiaohongshu.com/user/profile/5d8f88dc0000000001005d4b',
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected profile/);
    });

    it('throws CommandExecutionError when the follow button is not found', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: false, state: 'failed', reason: 'Follow button not found on profile' },
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/Follow button not found/);
    });

    it('throws CommandExecutionError when the state flip times out', async () => {
        const page = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: false, state: 'failed', reason: 'Follow button click did not flip to 已关注 within 5s' },
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError for malformed evaluate payloads', async () => {
        const page1 = makePage([
            { not: 'a string' },
        ]);
        await expect(getCommand().func(page1, { 'user-id': validId })).rejects.toThrowError(/malformed current-url payload/);

        const page2 = makePage([
            `https://www.xiaohongshu.com/user/profile/${validId}`,
            { ok: 'yes', state: 'followed' },
        ]);
        await expect(getCommand().func(page2, { 'user-id': validId })).rejects.toThrowError(/malformed follow-action payload/);
    });

    describe('__test__.assertUserId', () => {
        it('normalizes raw user ids and URL forms', () => {
            expect(__test__.assertUserId(validId)).toBe(validId);
            expect(__test__.assertUserId(`https://www.xiaohongshu.com/user/profile/${validId}`)).toBe(validId);
            expect(__test__.assertUserId(`https://www.xiaohongshu.com/user/profile/${validId}?xsec_token=t`)).toBe(validId);
            expect(__test__.assertUserId(`https://www.xiaohongshu.com/user/profile/${validId}/`)).toBe(validId);
        });
        it('rejects too-short or non-alphanumeric ids', () => {
            expect(() => __test__.assertUserId('')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId('abc')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId('!!!')).toThrow(ArgumentError);
            expect(() => __test__.assertUserId(`https://evil.example/user/profile/${validId}`)).toThrow(ArgumentError);
            expect(() => __test__.assertUserId(`https://www.xiaohongshu.com/user/profile/${validId}/note123`)).toThrow(ArgumentError);
        });
    });

    it('throws CommandExecutionError when navigation lands on a non-Xiaohongshu host', async () => {
        const page = makePage([
            `https://evil.example/user/profile/${validId}`,
        ]);
        await expect(getCommand().func(page, { 'user-id': validId })).rejects.toThrowError(/expected Xiaohongshu profile host/);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
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
