import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApiGet, mockResolveUid } = vi.hoisted(() => ({
    mockApiGet: vi.fn(),
    mockResolveUid: vi.fn(),
}));
vi.mock('./utils.js', async (importOriginal) => ({
    ...(await importOriginal()),
    apiGet: mockApiGet,
    resolveUid: mockResolveUid,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import { log } from '@jackwener/opencli/logger';
import './user-videos.js';

const command = getRegistry().get('bilibili/user-videos');

/** One vlist entry shaped like /x/space/wbi/arc/search returns it. */
function vlistItem() {
    return {
        aid: 117181958331993,
        title: '去了一趟西班牙2.0（日全食篇）',
        bvid: 'BV1Na4Q64Eos',
        play: 2483267,
        comment: 3319,
        video_review: 42447,
        created: 1788058800,
        length: '24:34',
        pic: 'http://i0.hdslb.com/bfs/archive/cover.jpg',
        description: '时隔两个月',
        is_pay: 0,
    };
}

/** medialist response carrying the like counts vlist[] does not have. */
function mediaListPayload(thumbUp = 171225) {
    return { data: { media_list: [{ id: 117181958331993, cnt_info: { thumb_up: thumbUp } }] } };
}

/** arc/search first, then the medialist like lookup. */
function mockResponses(arcPayload, likePayload) {
    mockApiGet
        .mockResolvedValueOnce(arcPayload)
        .mockResolvedValueOnce(likePayload);
}

describe('bilibili user-videos adapter', () => {
    beforeEach(() => {
        mockApiGet.mockReset();
        mockResolveUid.mockReset().mockResolvedValue('946974');
    });

    it('surfaces cover / duration / exact timestamp already present in vlist', async () => {
        mockResponses({ data: { list: { vlist: [vlistItem()] } } }, mediaListPayload());
        const [row] = await command.func({}, { uid: '946974', limit: 1 });
        expect(row).toMatchObject({
            rank: 1,
            plays: 2483267,
            comments: 3319,
            danmaku: 42447,
            // date stays day-granularity; created_ts is the raw unix second.
            date: '2026-08-30',
            created_ts: 1788058800,
            duration: '24:34',
            duration_sec: 1474,
            bvid: 'BV1Na4Q64Eos',
            cover: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
            desc: '时隔两个月',
            is_pay: false,
        });
    });

    it('declares every emitted key in columns', async () => {
        mockResponses({ data: { list: { vlist: [vlistItem()] } } }, mediaListPayload());
        const [row] = await command.func({}, { uid: '946974', limit: 1 });
        expect(Object.keys(row).sort()).toEqual([...command.columns].sort());
    });

    it('backfills likes from medialist in one extra request, keyed by aid', async () => {
        mockResponses({ data: { list: { vlist: [vlistItem()] } } }, mediaListPayload(171225));
        const [row] = await command.func({}, { uid: '946974', limit: 1 });
        expect(row.likes).toBe(171225);
        expect(row.likes_known).toBe(true);
        // One arc/search + exactly one medialist call for the whole page.
        expect(mockApiGet).toHaveBeenCalledTimes(2);
        expect(mockApiGet.mock.calls[1][1]).toBe('/x/v2/medialist/resource/list');
        expect(mockApiGet.mock.calls[1][2].params).toMatchObject({
            biz_id: '946974',
            oid: 117181958331993,
            // Window is deliberately wider than the page: medialist skips some
            // uploads (paid courses etc.) and would otherwise drop later rows.
            ps: 7,
            sort_field: 1,
            with_current: true,
        });
    });

    it('reports likes as unknown instead of 0 when medialist does not cover the row', async () => {
        // --order click / stow: medialist only ever returns pubdate order, so a
        // row can be missing from it. That must read as unknown, not zero likes.
        mockResponses(
            { data: { list: { vlist: [vlistItem()] } } },
            { data: { media_list: [{ id: 999, cnt_info: { thumb_up: 5 } }] } },
        );
        const [row] = await command.func({}, { uid: '946974', limit: 1, order: 'click' });
        expect(row.likes).toBe(0);
        expect(row.likes_known).toBe(false);
    });

    it('keeps returning rows when the medialist lookup fails', async () => {
        mockApiGet
            .mockResolvedValueOnce({ data: { list: { vlist: [vlistItem()] } } })
            .mockRejectedValueOnce(new Error('medialist blew up'));
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const [row] = await command.func({}, { uid: '946974', limit: 1 });
        expect(row.title).toBe('去了一趟西班牙2.0（日全食篇）');
        expect(row.likes).toBe(0);
        expect(row.likes_known).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('medialist like lookup failed'));
        warn.mockRestore();
    });
});
