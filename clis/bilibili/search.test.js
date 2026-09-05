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

describe('bilibili search adapter', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
    });

    it('surfaces the metrics the search result already carries', async () => {
        mockApiGet.mockResolvedValue({ data: { result: [videoResult()] } });
        const [row] = await command.func({}, { query: 'rust', limit: 1 });
        expect(row).toMatchObject({
            rank: 1,
            title: 'rust 入门',
            author: '影视飓风',
            mid: '946974',
            // score keeps its historical meaning (= play); plays is the new name.
            score: 2483267,
            plays: 2483267,
            likes: 4457,
            danmaku: 42447,
            favorites: 919248,
            duration: '7:14',
            duration_sec: 434,
            pubdate_ts: 1788058800,
            url: 'https://www.bilibili.com/video/BV1Na4Q64Eos',
            desc: '一个 rust 教程',
        });
        // Protocol-relative image URLs are upgraded to https.
        expect(row.cover).toBe('https://i0.hdslb.com/bfs/archive/cover.jpg');
        expect(row.face).toBe('https://i2.hdslb.com/bfs/face/abc.jpg');
    });

    it('emits mid / face for user results too, without changing score semantics', async () => {
        mockApiGet.mockResolvedValue({
            data: {
                result: [{
                    uname: '影视<em>飓风</em>',
                    usign: ' 影视制作 ',
                    mid: 946974,
                    fans: 2000000,
                    upic: '//i2.hdslb.com/bfs/face/abc.jpg',
                }],
            },
        });
        const [row] = await command.func({}, { query: '影视飓风', type: 'user', limit: 1 });
        expect(row).toEqual({
            rank: 1,
            title: '影视飓风',
            author: '影视制作',
            mid: '946974',
            score: 2000000,
            url: 'https://space.bilibili.com/946974',
            face: 'https://i2.hdslb.com/bfs/face/abc.jpg',
        });
    });

    it('declares every emitted key in columns', async () => {
        mockApiGet.mockResolvedValue({ data: { result: [videoResult()] } });
        const [row] = await command.func({}, { query: 'rust', limit: 1 });
        expect(Object.keys(row).sort()).toEqual([...command.columns].sort());
    });
});
