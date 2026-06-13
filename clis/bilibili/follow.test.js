import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const { mockApiPost, mockFetchJson, mockGetSelfUid, mockResolveUid } = vi.hoisted(() => ({
    mockApiPost: vi.fn(),
    mockFetchJson: vi.fn(),
    mockGetSelfUid: vi.fn(),
    mockResolveUid: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiPost: mockApiPost,
    fetchJson: mockFetchJson,
    getSelfUid: mockGetSelfUid,
    resolveUid: mockResolveUid,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './follow.js';
import './unfollow.js';

describe('bilibili follow', () => {
    const command = getRegistry().get('bilibili/follow');

    beforeEach(() => {
        mockApiPost.mockReset();
        mockFetchJson.mockReset();
        mockGetSelfUid.mockReset();
        mockResolveUid.mockReset();
        mockResolveUid.mockImplementation(async (_page, input) => String(input));
        mockGetSelfUid.mockResolvedValue('11111111');
    });

    it('follows a user by numeric uid', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 2 } });

        const result = await command.func({}, { target: '9617619' });

        expect(mockFetchJson).toHaveBeenCalledWith({}, 'https://api.bilibili.com/x/relation?fid=9617619');
        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/relation/modify', {
            params: { fid: '9617619', act: 1, re_src: 11 },
        });
        expect(result).toEqual([{
            mid: '9617619', name: '', status: 'followed',
            url: 'https://space.bilibili.com/9617619',
        }]);
    });

    it('extracts uid from a space.bilibili.com URL without calling resolveUid', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 2 } });

        await command.func({}, { target: 'https://space.bilibili.com/9617619' });

        expect(mockResolveUid).not.toHaveBeenCalled();
        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/relation/modify', {
            params: { fid: '9617619', act: 1, re_src: 11 },
        });
    });

    it('resolves a username via resolveUid', async () => {
        mockResolveUid.mockResolvedValueOnce('555');
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 6 } });

        const result = await command.func({}, { target: '某up主' });

        expect(mockResolveUid).toHaveBeenCalledWith({}, '某up主');
        expect(result[0].mid).toBe('555');
    });

    it('reports already-following without calling modify when attribute is 2', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 2 } });

        const result = await command.func({}, { target: '9617619' });

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(result[0].status).toBe('already-following');
    });

    it('reports already-following for mutual-follow (attribute=6)', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 6 } });

        const result = await command.func({}, { target: '9617619' });

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(result[0].status).toBe('already-following');
    });

    it('refuses to follow yourself', async () => {
        mockGetSelfUid.mockResolvedValueOnce('9617619');

        await expect(command.func({}, { target: '9617619' })).rejects.toBeInstanceOf(ArgumentError);
        expect(mockFetchJson).not.toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('rejects an empty target before touching the API', async () => {
        await expect(command.func({}, { target: '   ' })).rejects.toBeInstanceOf(ArgumentError);
        expect(mockGetSelfUid).not.toHaveBeenCalled();
    });

    it('rejects malformed Bilibili profile URLs instead of searching the whole URL', async () => {
        await expect(command.func({}, { target: 'https://space.bilibili.com/not-a-uid' })).rejects.toBeInstanceOf(ArgumentError);
        expect(mockResolveUid).not.toHaveBeenCalled();
        expect(mockFetchJson).not.toHaveBeenCalled();
    });

    it('propagates EmptyResultError when resolveUid finds no user', async () => {
        mockResolveUid.mockRejectedValueOnce(new EmptyResultError('bilibili user search'));

        await expect(command.func({}, { target: '幽灵用户zzz' })).rejects.toBeInstanceOf(EmptyResultError);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('refuses to follow when the target is blocked (attribute=128)', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 128 } });

        await expect(command.func({}, { target: '9617619' })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('maps login/csrf failures from modify to AuthRequiredError', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: -101, message: '账号未登录' });

        await expect(command.func({}, { target: '9617619' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('requires the relation to verify as following after modify succeeds', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });

        await expect(command.func({}, { target: '9617619' })).rejects.toThrow(/did not verify following/);
    });

    it('throws when relation query returns malformed attribute', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: {} });

        await expect(command.func({}, { target: '9617619' })).rejects.toThrow(/malformed attribute/);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('throws CommandExecutionError with the upstream code on non-auth modify failure', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });
        mockApiPost.mockResolvedValueOnce({ code: 22002, message: 'follow too fast' });

        await expect(command.func({}, { target: '9617619' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws when no browser session is provided', async () => {
        await expect(command.func(null, { target: '9617619' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('bilibili unfollow', () => {
    const command = getRegistry().get('bilibili/unfollow');

    beforeEach(() => {
        mockApiPost.mockReset();
        mockFetchJson.mockReset();
        mockGetSelfUid.mockReset();
        mockResolveUid.mockReset();
        mockResolveUid.mockImplementation(async (_page, input) => String(input));
        mockGetSelfUid.mockResolvedValue('11111111');
    });

    it('unfollows a followed user and verifies the relation flipped', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 2 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });

        const result = await command.func({}, { target: '9617619' });

        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/relation/modify', {
            params: { fid: '9617619', act: 2, re_src: 11 },
        });
        expect(result[0].status).toBe('unfollowed');
    });

    it('returns not-following without calling modify when already not following', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 0 } });

        const result = await command.func({}, { target: '9617619' });

        expect(mockApiPost).not.toHaveBeenCalled();
        expect(result[0].status).toBe('not-following');
    });

    it('requires the relation to verify as not-following after modify succeeds', async () => {
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 6 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        mockFetchJson.mockResolvedValueOnce({ code: 0, data: { attribute: 6 } });

        await expect(command.func({}, { target: '9617619' })).rejects.toThrow(/did not verify not following/);
    });
});
