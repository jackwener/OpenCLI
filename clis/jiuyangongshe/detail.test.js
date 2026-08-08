import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './detail.js';

/**
 * Build a minimal Nuxt SSR HTML response that the shared extractNuxtPayload
 * helper can parse. We keep it string-shaped so the IIFE in ssrPayload.js
 * runs through its real code path (not a mock).
 */
function nuxtHtml(payload) {
    const body = `<html><body>placeholder</body>
<script>window.__NUXT__=(function(){return (${JSON.stringify(payload)});})();</script>
</html>`;
    return body;
}

const baseArticle = {
    article_id: '4ejtumnjrmy',
    title: '某白酒龙头的护城河分析',
    content: '<p>本周调研要点：</p><p>1. 渠道库存健康<br>2. 终端动销回升</p>',
    user: {
        nickname: '研究员A',
        user_id: 'u_100',
        avatar: 'https://cdn.example/avatar/u_100.jpg',
        style_str: 'gold',
    },
    stock_list: [
        { name: '贵州茅台', code: 'sh600519' },
        { name: '五粮液', code: 'sz000858' },
    ],
    comment_count: 42,
    like_count: 318,
    collect_count: 91,
    forward_count: 17,
    step_count: 12580,
    integral: 12,
    create_time: 1719384000,
    sync_time: 1719470400,
    new_interaction_time: 1719556800,
    is_top: 0,
    categoryIdSet: ['c1', 'c2'],
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('jiuyangongshe detail command', () => {
    const cmd = getRegistry().get('jiuyangongshe/detail');

    it('registers with the correct metadata', () => {
        expect(cmd).toBeDefined();
        expect(cmd).toMatchObject({
            site: 'jiuyangongshe',
            name: 'detail',
            domain: 'www.jiuyangongshe.com',
            access: 'read',
            strategy: 'public',
            browser: false,
        });
        expect(cmd.columns).toEqual([
            'id', 'title', 'author', 'publishedAt', 'updatedAt',
            'views', 'comments', 'likes', 'forwards', 'tickers', 'url', 'summary',
        ]);
    });

    it('rejects empty / missing id before any network call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ id: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({})).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: '   ' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('shapes the article row from a populated SSR payload', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ data: baseArticle }] }), { status: 200 }),
        ));
        const rows = await cmd.func({ id: '4ejtumnjrmy' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: '4ejtumnjrmy',
            title: '某白酒龙头的护城河分析',
            author: '研究员A',
            authorId: 'u_100',
            views: 12580,
            comments: 42,
            likes: 318,
            forwards: 17,
            url: 'https://www.jiuyangongshe.com/a/4ejtumnjrmy',
        });
        expect(rows[0].tickers).toEqual([
            '贵州茅台(sh600519)',
            '五粮液(sz000858)',
        ]);
        expect(rows[0].summary).toContain('渠道库存健康');
    });

    it('strips HTML tags from the body summary', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ data: baseArticle }] }), { status: 200 }),
        ));
        const rows = await cmd.func({ id: '4ejtumnjrmy' });
        expect(rows[0].summary).not.toMatch(/<[^>]+>/);
        expect(rows[0].summary).not.toContain('&nbsp;');
    });

    it('returns EmptyResultError when the payload has no article body', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{}] }), { status: 200 }),
        ));
        await expect(cmd.func({ id: 'ghost' })).rejects.toThrow(EmptyResultError);
    });

    it('returns EmptyResultError when data[0] is missing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [] }), { status: 200 }),
        ));
        await expect(cmd.func({ id: 'ghost' })).rejects.toThrow(EmptyResultError);
    });

    it('maps a 5xx upstream to JYS_HTTP_ERROR via the shared relabel', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response('upstream down', { status: 503, statusText: 'Service Unavailable' }),
        ));
        await expect(cmd.func({ id: '4ejtumnjrmy' })).rejects.toMatchObject({
            code: 'JYS_HTTP_ERROR',
        });
    });

    it('maps a fetch network failure to JYS_NETWORK', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        await expect(cmd.func({ id: '4ejtumnjrmy' })).rejects.toMatchObject({
            code: 'JYS_NETWORK',
        });
    });

    it('URL-encodes the article id before fetching', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ data: baseArticle }] }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        await cmd.func({ id: 'a/b?id=1' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledUrl = fetchMock.mock.calls[0][0];
        expect(calledUrl).toBe('https://www.jiuyangongshe.com/a/a%2Fb%3Fid%3D1');
    });
});