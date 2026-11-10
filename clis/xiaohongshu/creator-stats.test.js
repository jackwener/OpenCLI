import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './creator-stats.js';

function pageWithBodies(bodies) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(() => {
            const body = bodies.shift();
            if (body === undefined) throw new Error('Unexpected browser action');
            return body;
        }),
    };
}

function periodStats(viewCount) {
    return {
        view_count: viewCount,
        view_list: [{ count: 1 }, { count: 2 }],
        view_time_avg: 9,
        view_time_list: [{ count: 4 }],
        home_view_count: 3,
        home_view_list: [{ count: 3 }],
        like_count: 5,
        like_list: [{ count: 5 }],
        collect_count: 6,
        collect_list: [{ count: 6 }],
        comment_count: 7,
        comment_list: [{ count: 7 }],
        danmaku_count: 0,
        share_count: 8,
        share_list: [{ count: 8 }],
        rise_fans_count: 2,
        rise_fans_list: [{ count: 2 }],
    };
}

describe('xiaohongshu creator-stats', () => {
    it.each([
        ['seven', 'set_seven', 70],
        ['thirty', 'set_thirty', 300],
    ])('maps %s to the current %s response bucket', async (period, bucket, views) => {
        const command = getRegistry().get('xiaohongshu/creator-stats');
        const page = pageWithBodies([{
            data: {
                [bucket]: periodStats(views),
            },
        }]);

        const rows = await command.func(page, { period });

        expect(page.goto).toHaveBeenCalledWith('https://creator.xiaohongshu.com/new/home');
        expect(rows[0]).toEqual({
            metric: '观看数 (views)',
            total: views,
            trend: '1 → 2',
        });
    });

    it('keeps compatibility with the older unprefixed response buckets', async () => {
        const command = getRegistry().get('xiaohongshu/creator-stats');
        const page = pageWithBodies([{ data: { seven: periodStats(70) } }]);

        const rows = await command.func(page, { period: 'seven' });

        expect(rows[0].total).toBe(70);
    });
});
