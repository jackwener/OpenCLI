/**
 * Unit tests for the 红果短剧 (Hongguo) adapter.
 *
 * Commands run through the registry with `fetch` stubbed; payloads are trimmed
 * real captures from hongguoduanju.com (2026-11-19) under __fixtures__.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { extractRouterData, normalizeSeriesId, requireLimit } from './utils.js';
import './feed.js';
import './rank.js';
import './search.js';
import './detail.js';
import './reviews.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

const FEED_INITIAL = fx('feed-initial.json');
const FEED_MORE = fx('feed-more.json');
const RANK = fx('rank-hot-drama.json');
const SEARCH = fx('search.json');
const DETAIL = fx('detail.json');
const PLAYER = fx('player-episode.json');

function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

/** Mimic the real SSR page: the object literal is followed by more inline code. */
function ssrPage(routerData) {
    return `<html><head><script>_ROUTER_DATA = ${JSON.stringify(routerData)};
function runWindowFn(){window[document.currentScript.getAttribute("data-fn-name")].apply(window,[])}</script></head><body><div id="root"></div></body></html>`;
}

function htmlResponse(html, status = 200) {
    return new Response(html, { status, headers: { 'content-type': 'text/html' } });
}

const cmd = (name) => getRegistry().get(`hongguo/${name}`);

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('hongguo registry', () => {
    it.each(['feed', 'rank', 'search', 'detail', 'reviews'])('%s is a public, read-only, browserless command', (name) => {
        const c = cmd(name);
        expect(c).toBeDefined();
        expect(c.strategy).toBe(Strategy.PUBLIC);
        expect(c.browser).toBe(false);
        expect(c.access).toBe('read');
    });

    it.each(['feed', 'rank', 'search'])('%s listing exposes series_id, which detail accepts', (name) => {
        expect(cmd(name).columns).toContain('series_id');
        expect(cmd('detail').args.find((a) => a.positional)?.name).toBe('series_id');
    });
});

describe('hongguo utils', () => {
    it('extractRouterData stops at the balanced brace despite trailing script', () => {
        const data = { loaderData: { page: { a: 1 } } };
        expect(extractRouterData(ssrPage(data))).toEqual(data);
    });

    it('extractRouterData ignores braces and escaped quotes inside strings', () => {
        const data = { loaderData: { t: 'a } b { "q" \\ }' } };
        expect(extractRouterData(`x;_ROUTER_DATA = ${JSON.stringify(data)};{}`)).toEqual(data);
    });

    it('extractRouterData returns null for missing, unbalanced or invalid blobs', () => {
        expect(extractRouterData('<html>nothing</html>')).toBeNull();
        expect(extractRouterData('_ROUTER_DATA = {"a":1')).toBeNull();
        expect(extractRouterData('_ROUTER_DATA = {a:1};')).toBeNull();
    });

    it('normalizeSeriesId accepts ids and site URLs, rejects junk', () => {
        expect(normalizeSeriesId('7706512650816982040')).toBe('7706512650816982040');
        expect(normalizeSeriesId('https://hongguoduanju.com/detail?series_id=7706512650816982040')).toBe('7706512650816982040');
        expect(normalizeSeriesId('https://hongguoduanju.com/player/7706512650816982040')).toBe('7706512650816982040');
        expect(() => normalizeSeriesId('少夫人来自东北')).toThrow(ArgumentError);
        expect(() => normalizeSeriesId(' ')).toThrow(ArgumentError);
    });

    it('requireLimit rejects out-of-range values instead of clamping', () => {
        expect(requireLimit(undefined, 10, 50)).toBe(10);
        expect(() => requireLimit(0, 10, 50)).toThrow(ArgumentError);
        expect(() => requireLimit(51, 10, 50)).toThrow(ArgumentError);
        expect(() => requireLimit(2.5, 10, 50)).toThrow(ArgumentError);
    });
});

describe('hongguo feed', () => {
    it('continues the session with the ttwid cookie and de-duplicates series', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse(FEED_INITIAL, 200, { 'set-cookie': 'ttwid=1%7Cabc; Path=/; HttpOnly' }))
            .mockResolvedValueOnce(jsonResponse(FEED_MORE));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('feed').func({ limit: 5 });

        expect(rows.map((r) => r.series_id)).toEqual([
            '7702401334808431678',
            '7705824595416190014',
            '7703125506568244248',
            '7705721000729513022',
            '7706110640078736408',
        ]);
        expect(rows[0]).toEqual({
            rank: 1,
            series_id: '7702401334808431678',
            title: '落魄老头亮出身份，都吓傻了',
            episodes: 80,
            tags: '总裁, 都市, 豪门',
            intro: expect.any(String),
            url: 'https://hongguoduanju.com/detail?series_id=7702401334808431678',
        });
        expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);

        const [firstUrl, firstInit] = fetchMock.mock.calls[0];
        expect(new URL(firstUrl).pathname).toBe('/api/home/feed');
        expect(new URL(firstUrl).searchParams.get('aid')).toBe('8662');
        expect(JSON.parse(firstInit.body)).toMatchObject({ action: 'initial', count: 10 });
        expect(firstInit.headers.Cookie).toBeUndefined();

        const [, secondInit] = fetchMock.mock.calls[1];
        const secondBody = JSON.parse(secondInit.body);
        expect(secondBody.action).toBe('load_more');
        expect(secondBody.shown_entry_ids).toEqual(FEED_INITIAL.items.map((i) => i.entry_id));
        expect(secondInit.headers.Cookie).toBe('ttwid=1%7Cabc');
    });

    it('stops after one page when the limit is already met', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(FEED_INITIAL));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('feed').func({ limit: 2 });
        expect(rows).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('stops when has_more is false and returns what it has', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ...FEED_INITIAL, has_more: false })));
        const rows = await cmd('feed').func({ limit: 10 });
        expect(rows).toHaveLength(3);
    });

    it('validates limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('feed').func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('feed').func({ limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps API errors and empty streams to typed errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error_code: 'INVALID_REQUEST' }, 400)));
        await expect(cmd('feed').func({ limit: 3 })).rejects.toThrow(/HTTP 400 \(INVALID_REQUEST\)/);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error_code: 'FEED_DISABLED', items: [] })));
        await expect(cmd('feed').func({ limit: 3 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error_code: 'OK', has_more: false, items: [] })));
        await expect(cmd('feed').func({ limit: 3 })).rejects.toBeInstanceOf(EmptyResultError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
        await expect(cmd('feed').func({ limit: 3 })).rejects.toThrow(/rate limited/);
    });

    it('typed-fails an item without a series id instead of emitting a blank row', async () => {
        const broken = { ...FEED_INITIAL, items: [{ entry_id: 'x', detail: { series_name: 'no id' } }] };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(broken)));
        await expect(cmd('feed').func({ limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('hongguo rank', () => {
    it('parses the SSR board and maps --type to the board slug', async () => {
        const fetchMock = vi.fn().mockResolvedValue(htmlResponse(ssrPage(RANK)));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('rank').func({ type: 'hot', limit: 2 });

        expect(fetchMock.mock.calls[0][0]).toBe('https://hongguoduanju.com/rank/hot-drama');
        expect(rows).toEqual([
            {
                rank: 1,
                series_id: '7705824595416190014',
                title: '穿越八零，我把娘俩宠成宝',
                metric: '8515万热度',
                score: '8分',
                favorites: '129.3万收藏',
                likes: '492.8万点赞',
                episodes: 317,
                tags: 'AI剧, 剧情, 赵乾志 · 陈芸',
                upcoming: false,
                url: 'https://hongguoduanju.com/detail?series_id=7705824595416190014',
            },
            expect.objectContaining({ rank: 2, series_id: '7704532495357725721', episodes: 113 }),
        ]);
    });

    it('finds the board under a route-specific loader key and pages until the limit', async () => {
        const board = RANK.loaderData['rank_hot-drama/page'];
        const newBoard = { loaderData: { layout: null, 'rank_new-drama/page': board } };
        const fetchMock = vi.fn().mockImplementation(async () => htmlResponse(ssrPage(newBoard)));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('rank').func({ type: 'new', limit: 5 });

        expect(rows).toHaveLength(5);
        expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
            'https://hongguoduanju.com/rank/new-drama',
            'https://hongguoduanju.com/rank/new-drama?page=2',
        ]);
    });

    it('flags not-yet-released series as upcoming without a detail url', async () => {
        const board = structuredClone(RANK.loaderData['rank_hot-drama/page']);
        board.content.rankList = [{
            id: '7708627749404953624',
            seriesId: '7708627749404953624',
            rank: 1,
            title: '持械入宋：第十二季',
            rankType: 'subscribe',
            reservationOnly: true,
            primaryMetricText: '2714.4万期待',
            favoriteText: '1004收藏',
            tags: ['AI剧', '古代'],
            episodeCount: 0,
        }];
        board.content.pagination = { pageNum: 1, totalPages: 1 };
        const fetchMock = vi.fn().mockResolvedValue(htmlResponse(ssrPage({ loaderData: { 'rank_subscribe-drama/page': board } })));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('rank').func({ type: 'subscribe', limit: 1 });

        expect(fetchMock.mock.calls[0][0]).toBe('https://hongguoduanju.com/rank/subscribe-drama');
        expect(rows[0]).toMatchObject({ series_id: '7708627749404953624', metric: '2714.4万期待', episodes: 0, upcoming: true, url: '' });
    });

    it('does not request pages beyond totalPages', async () => {
        const board = structuredClone(RANK.loaderData['rank_hot-drama/page']);
        board.content.pagination = { pageNum: 1, totalPages: 1 };
        const fetchMock = vi.fn().mockResolvedValue(htmlResponse(ssrPage({ loaderData: { 'rank_hot-drama/page': board } })));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('rank').func({ type: 'hot', limit: 50 });
        expect(rows).toHaveLength(3);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects unknown board types and bad limits before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('rank').func({ type: 'trending', limit: 5 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('rank').func({ type: 'hot', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('typed-fails pages without router data or without a board', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('<html>captcha</html>')));
        await expect(cmd('rank').func({ type: 'hot', limit: 3 })).rejects.toBeInstanceOf(CommandExecutionError);

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(ssrPage({ loaderData: { layout: null } }))));
        await expect(cmd('rank').func({ type: 'hot', limit: 3 })).rejects.toThrow(/carried no rankList/);
    });
});

describe('hongguo search', () => {
    it('returns series hits with heat/favorite/like text and skips non-series entries', async () => {
        const payload = structuredClone(SEARCH);
        payload.searchList.splice(1, 0, { doc_type: 99, name: 'not a series', user_info: {} });
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('search').func({ query: '重生', limit: 3 });

        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.pathname).toBe('/api/search/result');
        expect(url.searchParams.get('query')).toBe('重生');
        expect(url.searchParams.get('page')).toBeNull();
        expect(rows.map((r) => r.series_id)).toEqual(['7706434810419366937', '7688615525244488729', '7686008653844859966']);
        expect(rows[0]).toEqual({
            rank: 1,
            series_id: '7706434810419366937',
            title: '重生七零：我把冷面老公拿捏了',
            episodes: 169,
            heat: '4661万热度',
            favorites: '12.2万收藏',
            likes: '25.2万点赞',
            tags: '恋爱, 重生, 逆袭, 年代, 乡村',
            intro: expect.any(String),
            url: 'https://hongguoduanju.com/detail?series_id=7706434810419366937',
        });
    });

    it('fetches the next page with page=2 when more results are needed', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse(SEARCH))
            .mockResolvedValueOnce(jsonResponse({ ...SEARCH, hasMore: false }));
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('search').func({ query: '重生', limit: 5 });
        expect(rows).toHaveLength(5);
        expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('page')).toBe('2');
    });

    it('surfaces the captcha challenge as a typed error, not an empty result', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            jsonResponse({ code: 'search_verification_required' }, 403, { 'bdturing-verify': '{"x":1}' }),
        ));
        const err = await cmd('search').func({ query: '重生', limit: 3 }).catch((e) => e);
        expect(err).toBeInstanceOf(CommandExecutionError);
        expect(err.message).toMatch(/search_verification_required/);
    });

    it('maps no hits to EmptyResultError and validates args before fetching', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ searchList: [], hasMore: false })));
        await expect(cmd('search').func({ query: 'zz', limit: 3 })).rejects.toBeInstanceOf(EmptyResultError);

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('search').func({ query: '  ', limit: 3 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('search').func({ query: 'x', limit: 51 })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('typed-fails a payload without searchList', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: {} })));
        await expect(cmd('search').func({ query: 'x', limit: 3 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});

describe('hongguo detail', () => {
    it('renders series + social info as field/value rows', async () => {
        const fetchMock = vi.fn().mockResolvedValue(htmlResponse(ssrPage(DETAIL)));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('detail').func({ series_id: 'https://hongguoduanju.com/detail?series_id=7706512650816982040' });

        expect(fetchMock.mock.calls[0][0]).toBe('https://hongguoduanju.com/detail?series_id=7706512650816982040');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(map).toMatchObject({
            series_id: '7706512650816982040',
            title: '少夫人来自东北3',
            episodes: 96,
            total_episodes: 96,
            web_episodes: 5,
            tags: '家庭, 家庭温情, 团宠, 直爽女主, 豪门, 现代',
            cast: '梁雯晶 (饰 钱小卉), 业文Kevin (饰 周赫轩)',
            rating: 9.6,
            rating_count: 15204,
            heat: '7031万热度',
            likes: 2650000,
            favorites: 1401000,
            reviews: 2458,
            rank_label: '真人剧热播榜第1名',
            released: '2026-11-14',
            record_number: '(豫)微短剧备字(2026)第057号',
            url: 'https://hongguoduanju.com/detail?series_id=7706512650816982040',
        });
        expect(rows.map((r) => r.field)).toContain('intro');
    });

    it('maps an unknown series (HTTP 404) to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(ssrPage({ loaderData: { detail_layout: null } }), 404)));
        await expect(cmd('detail').func({ series_id: '1234567890123456789' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('typed-fails a 200 page without seriesDetail, and rejects junk ids before fetching', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse(ssrPage({ loaderData: { detail_page: {} } }))));
        await expect(cmd('detail').func({ series_id: '7706512650816982040' })).rejects.toBeInstanceOf(CommandExecutionError);

        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('detail').func({ series_id: 'abc' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('hongguo reviews', () => {
    const SID = '7706512650816982040';
    const VIDS = DETAIL.loaderData.detail_page.seriesDetail.vid_list;
    const PLAYER_KEY = 'player_(series_id)/(vid)/page';

    function playerFor(vid, tag) {
        const data = structuredClone(PLAYER);
        const page = data.loaderData[PLAYER_KEY];
        page.vid = vid;
        if (tag) for (const r of page.episodeSocialInfo.reviews.reviews) r.content = `${tag} ${r.content}`;
        return data;
    }

    /** detail + episode 1 (distinct comments) + episode 2 (fixture) + episode 3 served as the episode-1 fallback. */
    function siteMock(detail = DETAIL) {
        return vi.fn().mockImplementation(async (url) => {
            if (url.includes('/detail?')) return htmlResponse(ssrPage(detail));
            if (url.endsWith(`/${VIDS[0]}`)) return htmlResponse(ssrPage(playerFor(VIDS[0], 'ep1')));
            if (url.endsWith(`/${VIDS[1]}`)) return htmlResponse(ssrPage(PLAYER));
            if (url.endsWith(`/${VIDS[2]}`)) return htmlResponse(ssrPage(playerFor(VIDS[0], 'ep1')));
            throw new Error(`unexpected url ${url}`);
        });
    }

    it('collects series reviews then each web episode, dropping fallback pages', async () => {
        const fetchMock = siteMock();
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('reviews').func({ series_id: SID });

        expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
            `https://hongguoduanju.com/detail?series_id=${SID}`,
            `https://hongguoduanju.com/player/${SID}/${VIDS[0]}`,
            `https://hongguoduanju.com/player/${SID}/${VIDS[1]}`,
            `https://hongguoduanju.com/player/${SID}/${VIDS[2]}`,
        ]);
        expect(rows.map((r) => [r.scope, r.episode])).toEqual([
            ['series', null], ['series', null], ['series', null],
            ['episode', 1], ['episode', 1], ['episode', 1],
            ['episode', 2], ['episode', 2], ['episode', 2],
        ]);
        expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(rows[0]).toEqual({
            rank: 1,
            scope: 'series',
            episode: null,
            user: '用户1',
            rating: 10,
            likes: 660,
            time: '2026-11-14 00:51',
            content: expect.stringMatching(/^应抖音红果之邀/),
            scope_total: 2458,
        });
        expect(rows[6]).toEqual({
            rank: 7,
            scope: 'episode',
            episode: 2,
            user: '用户4',
            rating: null,
            likes: 112,
            time: expect.stringMatching(/^2026-11-1\d \d\d:\d\d$/),
            content: expect.stringMatching(/^爱了爱了/),
            scope_total: 3687,
        });
    });

    it('--scope series reads only the detail page; --scope episodes skips series reviews', async () => {
        let fetchMock = siteMock();
        vi.stubGlobal('fetch', fetchMock);
        const series = await cmd('reviews').func({ series_id: SID, scope: 'series' });
        expect(series.every((r) => r.scope === 'series')).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(1);

        fetchMock = siteMock();
        vi.stubGlobal('fetch', fetchMock);
        const episodes = await cmd('reviews').func({ series_id: SID, scope: 'episodes' });
        expect(episodes.every((r) => r.scope === 'episode')).toBe(true);
        expect(episodes).toHaveLength(6);
    });

    it('stops fetching episodes once the limit is reached', async () => {
        const fetchMock = siteMock();
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('reviews').func({ series_id: SID, limit: 4 });
        expect(rows).toHaveLength(4);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('de-duplicates a comment the site repeats on another episode', async () => {
        const fetchMock = vi.fn().mockImplementation(async (url) => {
            if (url.includes('/detail?')) return htmlResponse(ssrPage(DETAIL));
            const vid = url.split('/').pop();
            return htmlResponse(ssrPage(playerFor(vid)));
        });
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('reviews').func({ series_id: SID, scope: 'episodes' });
        expect(rows).toHaveLength(3);
        expect(rows.every((r) => r.episode === 1)).toBe(true);
    });

    it('--rounds re-fetches each episode page and merges newly rotated comments', async () => {
        let call = 0;
        const fetchMock = vi.fn().mockImplementation(async (url) => {
            if (url.includes('/detail?')) return htmlResponse(ssrPage(DETAIL));
            const vid = url.split('/').pop();
            if (vid !== VIDS[0]) return htmlResponse(ssrPage(playerFor(VIDS[0])));
            const data = playerFor(VIDS[0]);
            const list = data.loaderData[PLAYER_KEY].episodeSocialInfo.reviews.reviews;
            list[0] = { ...list[0], user_name: `rotated${call}`, content: `rotated comment ${call}` };
            call++;
            return htmlResponse(ssrPage(data));
        });
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd('reviews').func({ series_id: SID, scope: 'episodes', rounds: 3 });

        // 3 rounds of episode 1 (2 stable + 1 rotated each → 2 + 3), then episode 2 is a fallback page and stops after one fetch.
        expect(rows.map((r) => r.user)).toEqual(['rotated0', '用户5', '用户6', 'rotated1', 'rotated2']);
        expect(fetchMock.mock.calls.map((c) => c[0].split('/').pop())).toEqual([
            `detail?series_id=${SID}`, VIDS[0], VIDS[0], VIDS[0], VIDS[1], VIDS[2],
        ]);
    });

    it('ignores pay_type and still crawls the web-playable episodes', async () => {
        const paid = structuredClone(DETAIL);
        paid.loaderData.detail_page.seriesDetail.pay_type = 1;
        const fetchMock = siteMock(paid);
        vi.stubGlobal('fetch', fetchMock);
        const rows = await cmd('reviews').func({ series_id: SID, scope: 'episodes' });
        expect(rows).toHaveLength(6);
        expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('reports an empty episode scope when the site exposes no web episodes', async () => {
        const none = structuredClone(DETAIL);
        none.loaderData.detail_page.seriesDetail.accessible_episode_cnt = 0;
        const fetchMock = siteMock(none);
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('reviews').func({ series_id: SID, scope: 'episodes' })).rejects.toBeInstanceOf(EmptyResultError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('validates args before fetching and maps an unknown series to EmptyResultError', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd('reviews').func({ series_id: SID, scope: 'comments' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('reviews').func({ series_id: SID, limit: 201 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('reviews').func({ series_id: SID, rounds: 6 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('reviews').func({ series_id: SID, rounds: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd('reviews').func({ series_id: 'x' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse('', 404)));
        await expect(cmd('reviews').func({ series_id: SID })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
