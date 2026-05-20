import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
const { mockApiGet } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
}));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import './comments.js';
describe('bilibili comments', () => {
    const command = getRegistry().get('bilibili/comments');
    beforeEach(() => {
        mockApiGet.mockReset();
    });
    it('resolves bvid to aid and fetches replies', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 12345 } }) // view endpoint
            .mockResolvedValueOnce({
            code: 0,
            data: {
                replies: [
                    {
                        rpid: 777,
                        member: { uname: 'Alice' },
                        content: { message: 'Great video!' },
                        like: 42,
                        rcount: 3,
                        ctime: 1700000000,
                    },
                ],
            },
        });
        const result = await command.func({}, { bvid: 'BV1WtAGzYEBm', limit: 5 });
        expect(mockApiGet).toHaveBeenNthCalledWith(1, {}, '/x/web-interface/view', { params: { bvid: 'BV1WtAGzYEBm' } });
        expect(mockApiGet).toHaveBeenNthCalledWith(2, {}, '/x/v2/reply/main', {
            params: { oid: 12345, type: 1, mode: 3, ps: 5 },
            signed: true,
        });
        expect(result).toEqual([
            {
                rank: 1,
                rpid: '777',
                author: 'Alice',
                text: 'Great video!',
                likes: 42,
                replies: 3,
                time: new Date(1700000000 * 1000).toISOString().slice(0, 16).replace('T', ' '),
            },
        ]);
    });
    it('fetches replies under a comment via /x/v2/reply/reply when --parent is given', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 12345 } }) // view endpoint
            .mockResolvedValueOnce({
            code: 0,
            data: {
                replies: [
                    {
                        rpid: 888,
                        member: { uname: 'AI视频小助理' },
                        content: { message: '视频总结：作者开了一家咖啡馆' },
                        like: 8,
                        rcount: 0,
                        ctime: 1700000000,
                    },
                ],
            },
        });
        const result = await command.func({}, { bvid: 'BV1WtAGzYEBm', parent: 777, limit: 5 });
        expect(mockApiGet).toHaveBeenNthCalledWith(1, {}, '/x/web-interface/view', { params: { bvid: 'BV1WtAGzYEBm' } });
        expect(mockApiGet).toHaveBeenNthCalledWith(2, {}, '/x/v2/reply/reply', {
            params: { oid: 12345, type: 1, root: 777, pn: 1, ps: 5 },
        });
        expect(result[0].author).toBe('AI视频小助理');
        expect(result[0].rpid).toBe('888');
        expect(result[0].text).toBe('视频总结：作者开了一家咖啡馆');
    });
    it('throws when aid cannot be resolved', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: {} }); // no aid
        await expect(command.func({}, { bvid: 'BVinvalid123', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('throws CommandExecutionError when replies is missing', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 99 } })
            .mockResolvedValueOnce({ code: 0, data: {} }); // no replies key
        await expect(command.func({}, { bvid: 'BV1xxx', limit: 5 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
    it('rejects out-of-range limits instead of silently clamping', async () => {
        await expect(command.func({}, { bvid: 'BV1xxx', limit: 999 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(mockApiGet).not.toHaveBeenCalled();
    });
    it('rejects invalid parent ids before fetching comments', async () => {
        await expect(command.func({}, { bvid: 'BV1xxx', parent: 0, limit: 5 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(mockApiGet).not.toHaveBeenCalled();
    });
    it('maps auth-like API errors to AuthRequiredError', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: -101, message: '账号未登录', data: null });
        await expect(command.func({}, { bvid: 'BV1xxx', limit: 5 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('throws EmptyResultError for explicit empty comments', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 1 } })
            .mockResolvedValueOnce({ code: 0, data: { replies: [] } });
        await expect(command.func({}, { bvid: 'BV1xxx', limit: 5 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
    it('collapses newlines in comment text', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 1 } })
            .mockResolvedValueOnce({
            code: 0,
            data: {
                replies: [
                    { rpid: 123, member: { uname: 'Bob' }, content: { message: 'line1\nline2\nline3' }, like: 0, rcount: 0, ctime: 0 },
                ],
            },
        });
        const result = (await command.func({}, { bvid: 'BV1xxx', limit: 5 }));
        expect(result[0].text).toBe('line1 line2 line3');
    });
    it('throws CommandExecutionError when a comment row lacks rpid', async () => {
        mockApiGet
            .mockResolvedValueOnce({ code: 0, data: { aid: 1 } })
            .mockResolvedValueOnce({
            code: 0,
            data: {
                replies: [
                    { member: { uname: 'Bob' }, content: { message: 'hi' }, like: 0, rcount: 0, ctime: 0 },
                ],
            },
        });
        await expect(command.func({}, { bvid: 'BV1xxx', limit: 5 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
