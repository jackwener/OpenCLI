import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet } = vi.hoisted(() => ({ mockApiGet: vi.fn() }));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './feed.js';

const command = getRegistry().get('bilibili/feed');

/** One video item shaped like /x/polymer/web-dynamic/v1/feed/all returns it. */
function videoItem() {
    return {
        id_str: '900',
        type: 'DYNAMIC_TYPE_AV',
        basic: { is_only_fans: false },
        modules: {
            module_author: {
                name: '影视飓风',
                mid: 946974,
                face: 'http://i2.hdslb.com/bfs/face/abc.jpg',
                pub_time: '3小时前',
                // 实测接口返的是字符串，adapter 负责转成数字。
                pub_ts: '1788058800',
            },
            module_dynamic: {
                major: {
                    archive: {
                        bvid: 'BV1Na4Q64Eos',
                        title: '去了一趟西班牙',
                        desc: '日全食篇',
                        cover: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
                        duration_text: '24:34',
                        jump_url: '//www.bilibili.com/video/BV1Na4Q64Eos/',
                        stat: { play: '248.3万', danmaku: '1.2万' },
                    },
                },
            },
            module_stat: { like: { count: 12 }, comment: { count: 3 } },
        },
    };
}

describe('bilibili feed adapter', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
    });

    it('surfaces the archive metadata the dynamic payload already carries', async () => {
        mockApiGet.mockResolvedValue({ data: { items: [videoItem()], has_more: false } });
        const [row] = await command.func({}, { limit: 1, type: 'all', pages: 1 });
        expect(row).toMatchObject({
            rank: 1,
            time: '3小时前',
            pub_ts: 1788058800,
            author: '影视飓风',
            mid: '946974',
            title: '去了一趟西班牙',
            type: 'video',
            duration: '24:34',
            duration_sec: 1474,
            plays: 2483000,
            danmaku: 12000,
            likes: 12,
            url: 'https://www.bilibili.com/video/BV1Na4Q64Eos/',
            bvid: 'BV1Na4Q64Eos',
            desc: '日全食篇',
            only_fans: false,
        });
        // http:// image URLs from the API are upgraded to https.
        expect(row.cover).toBe('https://i0.hdslb.com/bfs/archive/cover.jpg');
        expect(row.face).toBe('https://i2.hdslb.com/bfs/face/abc.jpg');
    });

    it('keeps the new columns empty for non-video dynamics instead of dropping the row', async () => {
        mockApiGet.mockResolvedValue({
            data: {
                items: [{
                    id_str: '901',
                    type: 'DYNAMIC_TYPE_WORD',
                    modules: {
                        module_author: { name: 'Alice', mid: 1, pub_time: '昨天 20:15', pub_ts: 1788000000 },
                        module_dynamic: { desc: { text: 'hello' } },
                        module_stat: { like: { count: 1 } },
                    },
                }],
                has_more: false,
            },
        });
        const [row] = await command.func({}, { limit: 1, type: 'all', pages: 1 });
        expect(row).toMatchObject({
            title: 'hello',
            type: 'text',
            pub_ts: 1788000000,
            mid: '1',
            bvid: '',
            cover: '',
            duration: '',
            duration_sec: 0,
            plays: 0,
            danmaku: 0,
            only_fans: false,
        });
    });

    it('declares every emitted key in columns', async () => {
        mockApiGet.mockResolvedValue({ data: { items: [videoItem()], has_more: false } });
        const [row] = await command.func({}, { limit: 1, type: 'all', pages: 1 });
        expect(Object.keys(row).sort()).toEqual([...command.columns].sort());
    });
});
