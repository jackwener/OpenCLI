import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

const command = getRegistry().get('bilibili/search');

describe('bilibili search --type user', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
    });

    it('keeps the historical columns and adds semantic ones with numeric counts', async () => {
        mockApiGet.mockResolvedValue({
            data: {
                result: [{
                    uname: '影视<em>飓风</em>',
                    usign: ' 影视制作 ',
                    mid: 946974,
                    fans: 2000000,
                    videos: 812,
                    level: 6,
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
            // Semantic names for the same data; numbers stay numbers.
            name: '影视飓风',
            sign: '影视制作',
            fans: 2000000,
            videos: 812,
            level: 6,
            url: 'https://space.bilibili.com/946974',
            face: 'https://i2.hdslb.com/bfs/face/abc.jpg',
            avatar: 'https://i2.hdslb.com/bfs/face/abc.jpg',
        });
    });

    it('falls back to 0 / null when the API omits counts', async () => {
        mockApiGet.mockResolvedValue({ data: { result: [{ uname: 'u', mid: 1 }] } });
        const [row] = await command.func({}, { query: 'u', type: 'user', limit: 1 });
        expect(row).toMatchObject({ name: 'u', sign: '', fans: 0, videos: 0, level: null, score: 0 });
    });
});
