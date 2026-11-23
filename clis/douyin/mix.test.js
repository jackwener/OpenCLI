import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseMixTarget } from './mix.js';

const mixId = '7697274036942571554';
const videoId = '7697274002573872394';
const command = [...getRegistry().values()].find((c) => c.site === 'douyin' && c.name === 'mix');

function aweme(n, extra = {}) {
    return {
        aweme_id: `77000000000000000${String(n).padStart(2, '0')}`,
        desc: `第${n}集`,
        create_time: 1795416218,
        video: { duration: 97400 },
        author: { nickname: '老十一剧场' },
        statistics: { digg_count: 10 * n, comment_count: n, collect_count: 2, share_count: 3 },
        mix_info: { mix_id: mixId, mix_name: '持械入宋：第十季', statis: { current_episode: n } },
        ...extra,
    };
}

function pageFor(route, landedPath = `/video/${videoId}`) {
    const urls = [];
    return {
        urls,
        goto: vi.fn(),
        wait: vi.fn(),
        evaluate: async (script) => script === 'location.pathname' ? landedPath : new Function('fetch', `return (${script})`)(async (url) => {
            urls.push(new URL(url));
            const body = route(new URL(url));
            return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
        }),
    };
}

/** Two mix pages (episodes 1-2, then 3 + a repeated 2); detail of `videoId` points at the mix. */
function mixSite({ detailMix = { mix_id: mixId } } = {}) {
    return pageFor((url) => {
        if (url.pathname.endsWith('/aweme/detail/')) return { status_code: 0, aweme_detail: { aweme_id: videoId, mix_info: detailMix } };
        expect(url.pathname).toBe('/aweme/v1/web/mix/aweme/');
        expect(url.searchParams.get('mix_id')).toBe(mixId);
        return url.searchParams.get('cursor') === '0'
            ? { status_code: 0, aweme_list: [aweme(1), aweme(2)], cursor: 20, has_more: 1 }
            : { status_code: 0, aweme_list: [aweme(3), aweme(2)], cursor: 40, has_more: 0 };
    });
}

describe('douyin mix', () => {
    it.each([
        [mixId, { mixId }],
        [`https://www.douyin.com/collection/${mixId}`, { mixId }],
        [`https://www.douyin.com/video/${videoId}`, { video: `https://www.douyin.com/video/${videoId}` }],
        ['https://v.douyin.com/abc/', { video: 'https://v.douyin.com/abc/' }],
    ])('parses %s', (input, expected) => {
        expect(parseMixTarget(input)).toEqual(expected);
    });

    it.each(['', 'not a url', `http://www.douyin.com/collection/${mixId}`])('does not treat %j as a mix id', (input) => {
        if (!input || input === 'not a url') expect(() => parseMixTarget(input)).toThrow(ArgumentError);
        else expect(parseMixTarget(input)).toEqual({ video: input });
    });

    it('lists every episode of a mix id across pages, de-duplicated, with the documented columns', async () => {
        const page = mixSite();
        const rows = await command.func(page, { target: mixId, limit: 100 });
        expect(page.goto.mock.calls.map((c) => c[0])).toEqual([
            `https://www.douyin.com/collection/${mixId}`,
            `https://www.douyin.com/video/${videoId}`,
        ]);
        expect(rows.map((r) => r.episode)).toEqual([1, 2, 3]);
        expect(page.urls.map((u) => u.searchParams.get('cursor'))).toEqual(['0', '20']);
        expect(rows[0]).toEqual({
            episode: 1, aweme_id: '7700000000000000001', desc: '第1集', duration_s: 97, digg: 10, comment: 1,
            collect: 2, share: 3, created: '2026-11-23 14:43:38', author: '老十一剧场', mix_id: mixId,
            mix_name: '持械入宋：第十季', url: 'https://www.douyin.com/video/7700000000000000001',
        });
        expect(Object.keys(rows[0]).sort()).toEqual([...command.columns].sort());
    });

    it('resolves the mix from a video URL via the video detail', async () => {
        const page = mixSite();
        const rows = await command.func(page, { target: `https://www.douyin.com/video/${videoId}`, limit: 2 });
        expect(page.goto).toHaveBeenCalledWith(`https://www.douyin.com/video/${videoId}`);
        expect(page.urls[0].pathname).toBe('/aweme/v1/web/aweme/detail/');
        expect(rows).toHaveLength(2);
        expect(page.urls).toHaveLength(2);
    });

    it('reports a video outside any mix as an empty result', async () => {
        await expect(command.func(mixSite({ detailMix: null }), { target: `https://www.douyin.com/video/${videoId}` }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('reports an unknown mix as an empty result', async () => {
        const page = pageFor(() => ({ status_code: 0, aweme_list: null, cursor: 0, has_more: 0 }));
        await expect(command.func(page, { target: mixId })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it.each([0, 2001])('rejects --limit %s before touching the page', async (limit) => {
        const page = mixSite();
        await expect(command.func(page, { target: mixId, limit })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
