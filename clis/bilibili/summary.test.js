import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './summary.js';

describe('bilibili summary', () => {
    const command = getRegistry().get('bilibili/summary');

    beforeEach(() => {
        mockApiGet.mockReset();
    });

    it('returns the summary plus timestamped outline rows', async () => {
        mockApiGet
            .mockResolvedValueOnce({ data: { aid: 114, cid: 222, owner: { mid: 333 } } })
            .mockResolvedValueOnce({
            code: 0,
            data: {
                code: 0,
                model_result: {
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
                },
            },
        });

        const result = await command.func({}, { bvid: 'BV1xxx' });

        expect(mockApiGet).toHaveBeenNthCalledWith(1, {}, '/x/web-interface/view', { params: { bvid: 'BV1xxx' } });
        expect(mockApiGet).toHaveBeenNthCalledWith(2, {}, '/x/web-interface/view/conclusion/get', {
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
        mockApiGet
            .mockResolvedValueOnce({ data: { aid: 1, cid: 2, owner: { mid: 3 } } })
            .mockResolvedValueOnce({ code: 0, data: { code: 0, model_result: { summary: '只有总结', outline: [] } } });

        const result = await command.func({}, { bvid: 'BV1xxx' });

        expect(result).toEqual([{ time: '', content: '只有总结' }]);
    });

    it('throws when Bilibili has not generated an AI summary for the video', async () => {
        mockApiGet
            .mockResolvedValueOnce({ data: { aid: 1, cid: 2, owner: { mid: 3 } } })
            .mockResolvedValueOnce({ code: 0, data: { code: 1, model_result: {} } });

        await expect(command.func({}, { bvid: 'BV1xxx' })).rejects.toThrow(/no AI summary/i);
    });

    it('throws when the video info cannot be resolved', async () => {
        mockApiGet.mockResolvedValueOnce({ data: {} });

        await expect(command.func({}, { bvid: 'BVbroken' })).rejects.toThrow('Cannot resolve video info for bvid: BVbroken');
    });

    it('throws with the API code and message when the conclusion request fails', async () => {
        mockApiGet
            .mockResolvedValueOnce({ data: { aid: 1, cid: 2, owner: { mid: 3 } } })
            .mockResolvedValueOnce({ code: -403, message: '访问权限不足' });

        await expect(command.func({}, { bvid: 'BV1xxx' })).rejects.toThrow(/-403.*访问权限不足/);
    });
});
