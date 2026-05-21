import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const { mockApiGet, mockApiPost, mockResolveUid } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
    mockApiPost: vi.fn(),
    mockResolveUid: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
    apiPost: mockApiPost,
    resolveUid: mockResolveUid,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './comment.js';

describe('bilibili comment', () => {
    const command = getRegistry().get('bilibili/comment');

    beforeEach(() => {
        mockApiGet.mockReset();
        mockApiPost.mockReset();
        mockResolveUid.mockReset();
    });

    it('refuses to post without --execute', async () => {
        await expect(
            command.func({}, { bvid: 'BV1WtAGzYEBm', message: 'hi' }),
        ).rejects.toThrow(/--execute/);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('rejects an empty message before calling the API', async () => {
        await expect(
            command.func({}, { bvid: 'BV1xxx', message: '   ', execute: true }),
        ).rejects.toThrow(/empty/i);
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('posts a top-level comment, resolving @mentions to at_name_to_mid', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 12345 } });
        mockResolveUid.mockResolvedValueOnce('1141159409'); // @AI视频小助理 → mid
        mockApiPost.mockResolvedValueOnce({ code: 0, data: { rpid: 99887766 } });

        const result = await command.func({}, {
            bvid: 'BV1WtAGzYEBm', message: '@AI视频小助理 总结一下', execute: true,
        });

        expect(mockApiGet).toHaveBeenNthCalledWith(1, {}, '/x/web-interface/view', { params: { bvid: 'BV1WtAGzYEBm' } });
        expect(mockResolveUid).toHaveBeenCalledWith({}, 'AI视频小助理');
        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/v2/reply/add', {
            params: {
                oid: 12345,
                type: 1,
                message: '@AI视频小助理 总结一下',
                plat: 1,
                at_name_to_mid: '{"AI视频小助理":1141159409}',
            },
        });
        expect(result).toEqual([{
            rpid: '99887766',
            bvid: 'BV1WtAGzYEBm',
            oid: '12345',
            message: '@AI视频小助理 总结一下',
            url: 'https://www.bilibili.com/video/BV1WtAGzYEBm#reply99887766',
        }]);
    });

    it('still posts when an @mention cannot be resolved, leaving it as plain text', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 7 } });
        mockResolveUid.mockRejectedValueOnce(new EmptyResultError('bilibili user search'));
        mockApiPost.mockResolvedValueOnce({ code: 0, data: { rpid: 5 } });

        await command.func({}, { bvid: 'BV1xxx', message: '@幽灵用户zzz hi', execute: true });

        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/v2/reply/add', {
            params: { oid: 7, type: 1, message: '@幽灵用户zzz hi', plat: 1 },
        });
    });

    it('fails closed when mention resolution has parser or transport errors', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 7 } });
        mockResolveUid.mockRejectedValueOnce(new CommandExecutionError('search API drift'));

        await expect(
            command.func({}, { bvid: 'BV1xxx', message: '@用户 hi', execute: true }),
        ).rejects.toBeInstanceOf(CommandExecutionError);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('fails closed when mention resolution returns a malformed mid', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 7 } });
        mockResolveUid.mockResolvedValueOnce('not-a-mid');

        await expect(
            command.func({}, { bvid: 'BV1xxx', message: '@用户 hi', execute: true }),
        ).rejects.toBeInstanceOf(CommandExecutionError);
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('posts a reply under an existing comment when --parent is given', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 1 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: { rpid: 2 } });

        await command.func({}, { bvid: 'BV1xxx', message: 'thanks', parent: 555, execute: true });

        expect(mockApiPost).toHaveBeenCalledWith({}, '/x/v2/reply/add', {
            params: { oid: 1, type: 1, message: 'thanks', plat: 1, root: 555, parent: 555 },
        });
    });

    it('throws when the bvid cannot be resolved to an aid', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: {} });
        await expect(
            command.func({}, { bvid: 'BVbroken', message: 'hi', execute: true }),
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws with the API code and message when Bilibili rejects the comment', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 9 } });
        mockApiPost.mockResolvedValueOnce({ code: 12025, message: '评论字数过多' });
        await expect(
            command.func({}, { bvid: 'BV1xxx', message: 'x', execute: true }),
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps login/csrf failures from the write API to AuthRequiredError', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 9 } });
        mockApiPost.mockResolvedValueOnce({ code: -111, message: 'csrf 校验失败' });
        await expect(
            command.func({}, { bvid: 'BV1xxx', message: 'x', execute: true }),
        ).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rejects invalid parent ids before posting', async () => {
        await expect(
            command.func({}, { bvid: 'BV1xxx', message: 'x', parent: 0, execute: true }),
        ).rejects.toBeInstanceOf(ArgumentError);
        expect(mockApiGet).not.toHaveBeenCalled();
        expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('fails closed when the write API omits rpid', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { aid: 9 } });
        mockApiPost.mockResolvedValueOnce({ code: 0, data: {} });
        await expect(
            command.func({}, { bvid: 'BV1xxx', message: 'x', execute: true }),
        ).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
