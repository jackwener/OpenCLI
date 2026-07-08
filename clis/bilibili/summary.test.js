import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const { mockApiGet, mockResolveBvid } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
    mockResolveBvid: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
    resolveBvid: mockResolveBvid,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './summary.js';

describe('bilibili summary', () => {
    const command = getRegistry().get('bilibili/summary');
    const page = {};

    beforeEach(() => {
        mockApiGet.mockReset();
        mockResolveBvid.mockReset();
        mockResolveBvid.mockRejectedValue(new Error('short link not found'));
    });

    function mockView(data = { aid: 114, cid: 222, owner: { mid: 333 } }) {
        mockApiGet.mockResolvedValueOnce({ code: 0, data });
    }

    function mockConclusion(modelResult) {
        mockApiGet.mockResolvedValueOnce({
            code: 0,
            data: {
                code: 0,
                model_result: modelResult,
            },
        });
    }

    it('returns the summary plus timestamped outline rows', async () => {
        mockView();
        mockConclusion({
            summary: '整体总结',
            outline: [
                {
                    title: '第一节',
                    timestamp: 0,
                    part_outline: [
                        { timestamp: 12, content: '要点A' },
                        { timestamp: 3725, content: '要点B' },
                    ],
                },
            ],
        });

        const result = await command.func(page, { bvid: 'BV1xxx' });

        expect(mockApiGet).toHaveBeenNthCalledWith(1, page, '/x/web-interface/view', { params: { bvid: 'BV1xxx' } });
        expect(mockApiGet).toHaveBeenNthCalledWith(2, page, '/x/web-interface/view/conclusion/get', {
            params: { bvid: 'BV1xxx', cid: 222, up_mid: 333 },
            signed: true,
        });
        expect(result).toEqual([
            { time: '', content: '整体总结' },
            { time: '00:00', content: '# 第一节' },
            { time: '00:12', content: '要点A' },
            { time: '1:02:05', content: '要点B' },
        ]);
    });

    it('returns just the summary when the video has no outline', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion({ summary: '只有总结', outline: [] });

        await expect(command.func(page, { bvid: 'BV1xxx' })).resolves.toEqual([
            { time: '', content: '只有总结' },
        ]);
    });

    it('parses model_result when Bilibili returns it as a JSON string', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion(JSON.stringify({ summary: '字符串总结', outline: [] }));

        await expect(command.func(page, { bvid: 'BV1xxx' })).resolves.toEqual([
            { time: '', content: '字符串总结' },
        ]);
    });

    it('normalizes Bilibili video URLs before calling the APIs', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion({ summary: 'URL 总结', outline: [] });

        await command.func(page, {
            bvid: 'https://www.bilibili.com/video/BV1abc12345/?spm_id_from=333.1007',
        });

        expect(mockApiGet).toHaveBeenNthCalledWith(1, page, '/x/web-interface/view', { params: { bvid: 'BV1abc12345' } });
    });

    it('resolves b23.tv short links through the shared resolver', async () => {
        mockResolveBvid.mockResolvedValueOnce('BVshort12345');
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion({ summary: '短链总结', outline: [] });

        await command.func(page, { bvid: 'https://b23.tv/abc' });

        expect(mockResolveBvid).toHaveBeenCalledWith('https://b23.tv/abc');
        expect(mockApiGet).toHaveBeenNthCalledWith(1, page, '/x/web-interface/view', { params: { bvid: 'BVshort12345' } });
    });

    it('rejects invalid inputs before calling Bilibili APIs', async () => {
        const cases = [
            '',
            'javascript:alert(1)',
            'https://example.com/video/BV1abc12345',
            'https://share.note.youdao.com/video/BV1abc12345',
            'https://www.bilibili.com/read/cv12345',
        ];

        for (const bvid of cases) {
            await expect(command.func(page, { bvid })).rejects.toBeInstanceOf(ArgumentError);
        }
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('maps unresolved short-code inputs to ArgumentError without calling APIs', async () => {
        await expect(command.func(page, { bvid: 'not-a-bv' })).rejects.toBeInstanceOf(ArgumentError);

        expect(mockResolveBvid).toHaveBeenCalledWith('not-a-bv');
        expect(mockApiGet).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when Bilibili has not generated an AI summary for the video', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockApiGet.mockResolvedValueOnce({ code: 0, data: { code: 1, model_result: {} } });

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when the view payload is malformed', async () => {
        mockApiGet.mockResolvedValueOnce({ code: 0, data: {} });

        await expect(command.func(page, { bvid: 'BVbroken' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /cid\/up_mid/.test(err.message),
        );
    });

    it('throws CommandExecutionError when the view API returns a non-auth error', async () => {
        mockApiGet.mockResolvedValueOnce({ code: -404, message: '啥都木有' });

        await expect(command.func(page, { bvid: 'BVbroken' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /啥都木有.*-404/.test(err.message),
        );
    });

    it('maps conclusion auth or permission errors to AuthRequiredError', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockApiGet.mockResolvedValueOnce({ code: -403, message: '访问权限不足' });

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps conclusion non-auth API errors to CommandExecutionError', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockApiGet.mockResolvedValueOnce({ code: -500, message: 'server error' });

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /server error.*-500/.test(err.message),
        );
    });

    it('throws CommandExecutionError for malformed conclusion API payloads', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockApiGet.mockResolvedValueOnce(null);

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError for malformed model_result JSON', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion('{bad json');

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /model_result JSON/.test(err.message),
        );
    });

    it('throws CommandExecutionError for malformed outline shapes', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion({ summary: '坏 outline', outline: {} });

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /outline/.test(err.message),
        );
    });

    it('throws CommandExecutionError for malformed part outline shapes', async () => {
        mockView({ aid: 1, cid: 2, owner: { mid: 3 } });
        mockConclusion({
            summary: '坏 part_outline',
            outline: [{ title: '段落', timestamp: 0, part_outline: {} }],
        });

        await expect(command.func(page, { bvid: 'BV1xxx' })).rejects.toSatisfy(
            (err) => err instanceof CommandExecutionError && /part outline/.test(err.message),
        );
    });
});
