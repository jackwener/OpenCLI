import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';

/**
 * Build a minimal Nuxt SSR HTML response that the shared extractNuxtPayload
 * helper can parse. Real-world SSR payload for /search/new puts matched
 * rows under `data[0].list`; empty result sets render an empty list.
 */
function nuxtHtml(payload) {
    return `<html><body>placeholder</body>
<script>window.__NUXT__=(function(){return (${JSON.stringify(payload)});})();</script>
</html>`;
}

function makeArticle(article_id, title) {
    return {
        article_id,
        title,
        content: `<p>这是一篇关于 <b>${title}</b> 的调研笔记。</p>`,
        user: { nickname: '研究员', user_id: 'u_1' },
        stock_list: [{ name: title, code: 'sh600519' }],
        comment_count: 5,
        like_count: 20,
        collect_count: 3,
        forward_count: 1,
        step_count: 200,
        integral: 1,
        create_time: 1719384000,
        sync_time: 1719470400,
        new_interaction_time: 1719556800,
        is_top: 0,
        categoryIdSet: ['c1'],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('jiuyangongshe search command', () => {
    const cmd = getRegistry().get('jiuyangongshe/search');

    it('registers with the correct metadata', () => {
        expect(cmd).toBeDefined();
        expect(cmd).toMatchObject({
            site: 'jiuyangongshe',
            name: 'search',
            domain: 'www.jiuyangongshe.com',
            access: 'read',
            strategy: 'public',
            browser: false,
        });
        expect(cmd.columns).toEqual([
            'rank', 'id', 'title', 'author', 'publishedAt', 'summary',
            'views', 'comments', 'likes', 'forwards', 'tickers', 'url',
        ]);
        const limitArg = cmd.args.find((a) => a.name === 'limit');
        expect(limitArg).toMatchObject({ type: 'int', default: 20 });
    });

    it('rejects empty query before any network call', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({})).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: '   ' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps hits to ranked rows from a populated SSR payload', async () => {
        const html = nuxtHtml({
            data: [{
                list: [
                    makeArticle('a1', '茅台'),
                    makeArticle('a2', '茅台批发价'),
                ],
            }],
        });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(html, { status: 200 })));
        const rows = await cmd.func({ query: '茅台' });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'a1', title: '茅台',
            author: '研究员',
            views: 200, comments: 5, likes: 20, forwards: 1,
            url: 'https://www.jiuyangongshe.com/a/a1',
        });
        expect(rows[0].tickers).toEqual(['茅台(sh600519)']);
        expect(rows[1].rank).toBe(2);
    });

    it('caps the returned rows at --limit (default 20, max 50)', async () => {
        const items = Array.from({ length: 80 }, (_, i) => makeArticle(`id_${i}`, `hit_${i}`));
        // Fresh Response per call — Response bodies are single-use streams and
        // would otherwise trip "Body has already been read" across calls.
        const html = nuxtHtml({ data: [{ list: items }] });
        vi.stubGlobal('fetch', vi.fn().mockImplementation(
            () => Promise.resolve(new Response(html, { status: 200 })),
        ));
        const defaultRows = await cmd.func({ query: 'foo' });
        expect(defaultRows).toHaveLength(20);

        const tenRows = await cmd.func({ query: 'foo', limit: 10 });
        expect(tenRows).toHaveLength(10);

        const cappedRows = await cmd.func({ query: 'foo', limit: 999 });
        expect(cappedRows).toHaveLength(50);
    });

    it('treats malformed limit as the default', async () => {
        const items = Array.from({ length: 30 }, (_, i) => makeArticle(`id_${i}`, `hit_${i}`));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ list: items }] }), { status: 200 }),
        ));
        const rows = await cmd.func({ query: 'foo', limit: 'abc' });
        expect(rows).toHaveLength(20);
    });

    it('returns EmptyResultError when the search list is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ list: [] }] }), { status: 200 }),
        ));
        await expect(cmd.func({ query: 'nope' })).rejects.toThrow(EmptyResultError);
    });

    it('returns EmptyResultError when data[0].list is missing entirely', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{}] }), { status: 200 }),
        ));
        await expect(cmd.func({ query: 'nope' })).rejects.toThrow(EmptyResultError);
    });

    it('passes the keyword as a URL-encoded query string', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(nuxtHtml({ data: [{ list: [makeArticle('a1', 'x')] }] }), { status: 200 }),
        );
        vi.stubGlobal('fetch', fetchMock);
        await cmd.func({ query: '茅台 & 600519?' });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = fetchMock.mock.calls[0][0];
        expect(url).toBe(
            'https://www.jiuyangongshe.com/search/new?k=%E8%8C%85%E5%8F%B0%20%26%20600519%3F',
        );
    });

    it('maps a 5xx upstream to JYS_HTTP_ERROR', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response('upstream', { status: 502, statusText: 'Bad Gateway' }),
        ));
        await expect(cmd.func({ query: '茅台' })).rejects.toMatchObject({
            code: 'JYS_HTTP_ERROR',
        });
    });

    it('maps a fetch network failure to JYS_NETWORK', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
        await expect(cmd.func({ query: '茅台' })).rejects.toMatchObject({
            code: 'JYS_NETWORK',
        });
    });
});