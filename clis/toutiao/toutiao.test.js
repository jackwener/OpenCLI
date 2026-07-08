import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

import {
    HOT_BOARD_URL,
    __test__,
    mapHotRow,
    looksToutiaoAuthWallText,
    parseArticlesPage,
    parseHotLimit,
    parseToutiaoArticlesText,
} from './utils.js';

import './articles.js';
import './hot.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('toutiao parseArticlesPage', () => {
    it('falls back to default for empty / undefined / null', () => {
        expect(parseArticlesPage(undefined)).toBe(1);
        expect(parseArticlesPage(null)).toBe(1);
        expect(parseArticlesPage('')).toBe(1);
        expect(parseArticlesPage(undefined, 3)).toBe(3);
    });

    it('parses valid integer pages in [1, 4]', () => {
        expect(parseArticlesPage(1)).toBe(1);
        expect(parseArticlesPage('2')).toBe(2);
        expect(parseArticlesPage(4)).toBe(4);
    });

    it('rejects non-integer pages with ArgumentError', () => {
        expect(() => parseArticlesPage('abc')).toThrow(ArgumentError);
        expect(() => parseArticlesPage(1.5)).toThrow(ArgumentError);
    });

    it('rejects out-of-range pages with ArgumentError (no silent clamp)', () => {
        expect(() => parseArticlesPage(0)).toThrow(ArgumentError);
        expect(() => parseArticlesPage(5)).toThrow(ArgumentError);
        expect(() => parseArticlesPage(-1)).toThrow(ArgumentError);
        expect(() => parseArticlesPage(99)).toThrow(ArgumentError);
    });
});

describe('toutiao parseHotLimit', () => {
    it('falls back to default for empty / undefined / null', () => {
        expect(parseHotLimit(undefined)).toBe(30);
        expect(parseHotLimit(null)).toBe(30);
        expect(parseHotLimit('')).toBe(30);
        expect(parseHotLimit(undefined, 10)).toBe(10);
    });

    it('parses valid integer limits in [1, 50]', () => {
        expect(parseHotLimit(1)).toBe(1);
        expect(parseHotLimit('30')).toBe(30);
        expect(parseHotLimit(50)).toBe(50);
    });

    it('rejects out-of-range limits with ArgumentError (no silent clamp)', () => {
        expect(() => parseHotLimit(0)).toThrow(ArgumentError);
        expect(() => parseHotLimit(51)).toThrow(ArgumentError);
        expect(() => parseHotLimit(-1)).toThrow(ArgumentError);
        expect(() => parseHotLimit(1.5)).toThrow(ArgumentError);
    });

    it('rejects non-numeric limits with ArgumentError', () => {
        expect(() => parseHotLimit('abc')).toThrow(ArgumentError);
    });
});

describe('toutiao parseToutiaoArticlesText (silent column drop fix)', () => {
    const rowWithStats = [
        '短标题',
        '04-20 20:30',
        '已发布',
        '展现 8 阅读 0 点赞 0 评论 0',
    ].join('\n');

    it('keeps short chinese titles and emits full row when stats present', () => {
        expect(parseToutiaoArticlesText(rowWithStats)).toEqual([
            {
                title: '短标题',
                date: '04-20 20:30',
                status: '已发布',
                '展现': '8',
                '阅读': '0',
                '点赞': '0',
                '评论': '0',
            },
        ]);
    });

    it('still emits partial row with null stat columns when stats line failed to render', () => {
        // Regression: previously `if (title && stats) push` silently dropped
        // rows that had a title but where the stats span had not finished
        // rendering, masking creator-backend slow-render bugs.
        const partial = [
            '部分行 (stats 慢渲染)',
            '04-20 20:30',
            '已发布',
            // stats line absent on purpose
        ].join('\n');
        const out = parseToutiaoArticlesText(partial);
        expect(out).toEqual([
            {
                title: '部分行 (stats 慢渲染)',
                date: '04-20 20:30',
                status: '已发布',
                '展现': null,
                '阅读': null,
                '点赞': null,
                '评论': null,
            },
        ]);
    });

    it('returns empty array for non-text input', () => {
        expect(parseToutiaoArticlesText('')).toEqual([]);
        expect(parseToutiaoArticlesText(null)).toEqual([]);
        expect(parseToutiaoArticlesText(undefined)).toEqual([]);
    });

    it('handles multi-row input without losing rows', () => {
        const text = [
            '第一篇文章',
            '04-20 20:30',
            '已发布',
            '展现 100 阅读 50 点赞 5 评论 1',
            '',
            '第二篇文章',
            '04-21 09:15',
            '已发布',
            '展现 8 阅读 0 点赞 0 评论 0',
        ].join('\n');
        expect(parseToutiaoArticlesText(text)).toHaveLength(2);
    });
});

describe('toutiao auth wall detection', () => {
    it('recognizes creator-login/captcha pages', () => {
        expect(looksToutiaoAuthWallText('账号登录 请登录 mp.toutiao.com/profile_v4/login')).toBe(true);
        expect(looksToutiaoAuthWallText('安全验证 captcha')).toBe(true);
        expect(looksToutiaoAuthWallText('短标题 04-20 20:30 已发布 展现 1 阅读 1')).toBe(false);
    });
});

describe('toutiao mapHotRow', () => {
    it('projects upstream item to stable 8-column shape', () => {
        const upstream = {
            ClusterId: 12345,
            ClusterIdStr: '12345',
            Title: '某热点新闻',
            QueryWord: '某热点',
            HotValue: '987654',
            Label: '热',
            Url: 'https://www.toutiao.com/trending/12345/',
            Image: { url: 'https://p.image/x.jpg', url_list: ['https://p.image/x.jpg'] },
        };
        expect(mapHotRow(upstream, 0)).toEqual({
            rank: 1,
            group_id: '12345',
            title: '某热点新闻',
            query: '某热点',
            hot_value: 987654,
            label: '热',
            url: 'https://www.toutiao.com/trending/12345/',
            image_url: 'https://p.image/x.jpg',
        });
    });

    it('falls back to ClusterId numeric when ClusterIdStr missing', () => {
        const out = mapHotRow({ ClusterId: 7, Title: 'X' }, 5);
        expect(out.group_id).toBe('7');
        expect(out.rank).toBe(6);
    });

    it('falls back QueryWord → Title when query missing', () => {
        const out = mapHotRow({ Title: '只有标题' }, 0);
        expect(out.query).toBe('只有标题');
    });

    it('handles Image as url_list-only shape', () => {
        const out = mapHotRow({
            Title: 'Y',
            Image: { url_list: ['https://list.image/y.png'] },
        }, 0);
        expect(out.image_url).toBe('https://list.image/y.png');
    });

    it('handles live Image.url_list entries shaped as objects', () => {
        const out = mapHotRow({
            Title: 'Y',
            Image: { url_list: [{ url: 'https://list.image/y.png' }] },
        }, 0);
        expect(out.image_url).toBe('https://list.image/y.png');
    });

    it('returns null image when Image missing or all variants empty', () => {
        expect(mapHotRow({ Title: 'Z' }, 0).image_url).toBeNull();
        expect(mapHotRow({ Title: 'Z', Image: {} }, 0).image_url).toBeNull();
        expect(mapHotRow({ Title: 'Z', Image: { url_list: [] } }, 0).image_url).toBeNull();
    });

    it('drops untitled rows (returns null) instead of emitting empty-title row', () => {
        expect(mapHotRow({ Title: '', ClusterId: 1 }, 0)).toBeNull();
        expect(mapHotRow({ Title: '   ', ClusterId: 1 }, 0)).toBeNull();
        expect(mapHotRow(null, 0)).toBeNull();
        expect(mapHotRow('not-an-object', 0)).toBeNull();
    });

    it('returns null hot_value for non-numeric HotValue (no silent 0 sentinel)', () => {
        expect(mapHotRow({ Title: 'Q', HotValue: 'NaN' }, 0).hot_value).toBeNull();
        expect(mapHotRow({ Title: 'Q', HotValue: '-1' }, 0).hot_value).toBeNull();
    });
});

describe('toutiao registry shape', () => {
    const articles = getRegistry().get('toutiao/articles');
    const hot = getRegistry().get('toutiao/hot');

    it('articles is registered as browser/cookie read adapter', () => {
        expect(articles).toBeTruthy();
        expect(articles.access).toBe('read');
        expect(articles.browser).toBe(true);
        expect(articles.columns).toEqual(['title', 'date', 'status', '展现', '阅读', '点赞', '评论']);
    });

    it('hot is registered as public non-browser read adapter', () => {
        expect(hot).toBeTruthy();
        expect(hot.access).toBe('read');
        expect(hot.browser).toBe(false);
        expect(hot.columns).toEqual(['rank', 'group_id', 'title', 'query', 'hot_value', 'label', 'url', 'image_url']);
    });
});

describe('toutiao articles adapter (registry func)', () => {
    const cmd = getRegistry().get('toutiao/articles');

    it('rejects invalid page before browser navigation', async () => {
        const page = { goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn() };

        await expect(cmd.func(page, { page: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(page, { page: 5 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws AuthRequiredError when creator backend renders a login wall', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue('账号登录 请登录'),
        };

        await expect(cmd.func(page, { page: 1 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('wraps render failures as CommandExecutionError', async () => {
        const page = {
            goto: vi.fn().mockRejectedValue(new Error('browser down')),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { page: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when rendered article text has no rows', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue('没有文章'),
        };

        await expect(cmd.func(page, { page: 1 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('toutiao hot adapter (registry func)', () => {
    const cmd = getRegistry().get('toutiao/hot');

    it('rejects invalid limit before fetching (no silent clamp)', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func(null, { limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(null, { limit: 51 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func(null, { limit: 'abc' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('hits the public hot-board URL with default limit', async () => {
        const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
            new Response(JSON.stringify({
                data: [
                    { ClusterIdStr: '1', Title: 'A', HotValue: '100' },
                    { ClusterIdStr: '2', Title: 'B', HotValue: '200' },
                ],
            }), { status: 200 }),
        ));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func(null, {});
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(HOT_BOARD_URL);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ rank: 1, group_id: '1', title: 'A', hot_value: 100 });
        expect(rows[1]).toMatchObject({ rank: 2, group_id: '2', title: 'B', hot_value: 200 });
    });

    it('throws CommandExecutionError on non-OK HTTP', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response('', { status: 503 }),
        )));

        await expect(cmd.func(null, { limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError on malformed JSON', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response('not-json{{{', { status: 200 }),
        )));

        await expect(cmd.func(null, { limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError on in-band error envelope', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response(JSON.stringify({ status: 'error', message: 'rate limited' }), { status: 200 }),
        )));

        await expect(cmd.func(null, { limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws CommandExecutionError when fetch rejects (no silent catch)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.reject(new Error('network down'))));

        await expect(cmd.func(null, { limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when upstream payload is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response(JSON.stringify({ data: [] }), { status: 200 }),
        )));

        await expect(cmd.func(null, { limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('caps result rows at limit and dense-ranks (1..N) after filtering', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(
            new Response(JSON.stringify({
                data: [
                    { ClusterIdStr: '1', Title: 'kept' },
                    { ClusterIdStr: '2', Title: '' }, // empty title → dropped
                    { ClusterIdStr: '3', Title: 'also kept' },
                    { ClusterIdStr: '4', Title: 'over-limit' },
                ],
            }), { status: 200 }),
        )));

        const rows = await cmd.func(null, { limit: 2 });
        expect(rows.map(r => r.title)).toEqual(['kept', 'also kept']);
        expect(rows.map(r => r.rank)).toEqual([1, 2]); // dense rank after empty-title drop
    });
});

describe('toutiao __test__ contract', () => {
    it('exports min/max bounds for documentation parity', () => {
        expect(__test__.ARTICLES_MIN_PAGE).toBe(1);
        expect(__test__.ARTICLES_MAX_PAGE).toBe(4);
        expect(__test__.HOT_MIN_LIMIT).toBe(1);
        expect(__test__.HOT_MAX_LIMIT).toBe(50);
    });
});
