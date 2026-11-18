import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

const command = getRegistry().get('bilibili/search');

/** One video result shaped like /x/web-interface/wbi/search/type returns it. */
function videoResult() {
    return {
        title: '<em class="keyword">rust</em> 入门',
        author: '影视飓风',
        mid: 946974,
        bvid: 'BV1Na4Q64Eos',
        play: 2483267,
        like: 4457,
        danmaku: 42447,
        favorites: 919248,
        duration: '7:14',
        pubdate: 1788058800,
        pic: '//i0.hdslb.com/bfs/archive/cover.jpg',
        upic: '//i2.hdslb.com/bfs/face/abc.jpg',
        description: '一个 <em>rust</em> 教程',
    };
}

describe('bilibili search --within-days', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
    });

    it('passes no publish-time window by default', async () => {
        mockApiGet.mockResolvedValue({ data: { result: [] } });
        await command.func({}, { query: 'rust', limit: 1 });
        expect(mockApiGet.mock.calls[0][2].params).toEqual({ search_type: 'video', keyword: 'rust', page: 1 });
    });

    it('--within-days asks the API for videos published in the last N days', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-15T00:00:00Z'));
        try {
            mockApiGet.mockResolvedValue({ data: { result: [videoResult()] } });
            const [row] = await command.func({}, { query: 'rust', limit: 1, 'within-days': 7 });
            const [, path, opts] = mockApiGet.mock.calls[0];
            const now = Math.floor(Date.parse('2026-11-15T00:00:00Z') / 1000);
            expect(path).toBe('/x/web-interface/wbi/search/type');
            expect(opts.signed).toBe(true);
            expect(opts.params).toEqual({
                search_type: 'video',
                keyword: 'rust',
                page: 1,
                pubtime_begin_s: now - 7 * 86400,
                pubtime_end_s: now,
            });
            expect(row.title).toBe('rust 入门');
        } finally {
            vi.useRealTimers();
        }
    });

    it('--within-days leaves user search alone', async () => {
        mockApiGet.mockResolvedValue({ data: { result: [] } });
        await command.func({}, { query: 'u', type: 'user', limit: 1, 'within-days': 7 });
        expect(mockApiGet.mock.calls[0][2].params).toEqual({ search_type: 'bili_user', keyword: 'u', page: 1 });
    });
});
