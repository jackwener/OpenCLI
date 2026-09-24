import { getRegistry } from '@jackwener/opencli/registry';
import { describe, expect, it, vi } from 'vitest';
import { __test__ } from './notifications.js';

function makePage({ data = [] }) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async (js) => {
            if (js.includes('__config__')) return true;
            return { ok: true, status: 200, data: { data } };
        }),
    };
}
const notif = (id, viewed = 1) => ({ id, viewed, comment_id: id * 10, floor_id: id, created_at: 't', commenter_name: 'u', title: `n${id}`, post_id: 100 + id });

describe('nodeseek notifications', () => {
    it('maps an at-me entry into a row with a deep link to the comment floor', () => {
        const row = __test__.mapNotification({
            id: 3132107, viewed: 1, comment_id: 10738205, floor_id: 58,
            created_at: '2026-06-18T02:02:17.000Z', commenter_id: 47407,
            commenter_name: 'goodin', title: '香港归来港卡收获与踩坑记录', post_id: 781551,
        });
        expect(row).toMatchObject({
            viewed: 'read',
            commenter_name: 'goodin',
            title: '香港归来港卡收获与踩坑记录',
            post_id: 781551,
            floor_id: 58,
            // Site format: post-<id>-<page>#<floor>, floors paged 10/page —
            // floor 58 lives on page 6 (matches NodeSeek's own notification link).
            link: 'https://www.nodeseek.com/post-781551-6#58',
        });
    });

    it('falls back to page 1 without an anchor when floor_id is missing', () => {
        expect(__test__.mapNotification({ viewed: 1, post_id: 7, comment_id: 9 }).link)
            .toBe('https://www.nodeseek.com/post-7-1');
    });

    it('flags unread entries as NEW', () => {
        expect(__test__.mapNotification({ viewed: 0, post_id: 1, comment_id: 2 }).viewed).toBe('NEW');
    });

    const command = getRegistry().get('nodeseek/notifications');

    it('honors limit and the --unread filter', async () => {
        const data = [notif(1, 1), notif(2, 0), notif(3, 1)];
        expect(await command.func(makePage({ data }), { limit: 2 })).toHaveLength(2);
        const unread = await command.func(makePage({ data }), { unread: true, limit: 20 });
        expect(unread.map((r) => r.viewed)).toEqual(['NEW']);
    });

    it('rejects an out-of-range limit before fetching', async () => {
        await expect(command.func(makePage({ data: [] }), { limit: 0 })).rejects.toThrow();
        await expect(command.func(makePage({ data: [] }), { limit: 51 })).rejects.toThrow();
    });
});
