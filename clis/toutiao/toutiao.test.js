import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

import { RECOMMEND_CATEGORIES, mapHotRow, mapRecommendRow, looksToutiaoAuthWallText, parseArticlesPage, parseHotLimit, parseRecommendCategory, parseRecommendLimit, parseToutiaoArticlesText } from './utils.js';

import './articles.js';
import './hot.js';
import './recommend.js';

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
    const hot = getRegistry().get('toutiao/hot');

    it('public non-browser commands take a single args object', () => {
        // browser:false commands are invoked with one argument; declaring a
        // leading page param silently swallows the caller's flags.
        expect(hot.func.length).toBe(1);
        expect(getRegistry().get('toutiao/recommend').func.length).toBe(1);
    });
});

describe('toutiao parseRecommendLimit', () => {
    it('falls back when the value is absent', () => {
        expect(parseRecommendLimit(undefined, 20)).toBe(20);
        expect(parseRecommendLimit(null, 20)).toBe(20);
        expect(parseRecommendLimit('', 20)).toBe(20);
    });

    it('rejects out-of-range and non-integer values instead of clamping', () => {
        expect(() => parseRecommendLimit(0)).toThrow(ArgumentError);
        expect(() => parseRecommendLimit(51)).toThrow(ArgumentError);
        expect(() => parseRecommendLimit(1.5)).toThrow(ArgumentError);
        expect(() => parseRecommendLimit('abc')).toThrow(ArgumentError);
    });
});

describe('toutiao parseRecommendCategory', () => {
    it('accepts every advertised channel', () => {
        for (const category of RECOMMEND_CATEGORIES) {
            expect(parseRecommendCategory(category)).toBe(category);
        }
    });

    it('falls back to __all__ when absent', () => {
        expect(parseRecommendCategory(undefined)).toBe('__all__');
        expect(parseRecommendCategory('')).toBe('__all__');
    });

    it('rejects channels the endpoint does not serve', () => {
        // news_auto answers 200 with an empty payload and no message field, so
        // it stays off the allow-list rather than surfacing a fake outage.
        expect(() => parseRecommendCategory('news_auto')).toThrow(ArgumentError);
        expect(() => parseRecommendCategory('nonsense')).toThrow(ArgumentError);
    });
});

describe('toutiao mapRecommendRow', () => {
    it('projects a feed row into the stable shape', () => {
        const row = mapRecommendRow({
            group_id: 7663270543809937946n.toString(),
            title: 'T',
            abstract: 'A',
            source: 'S',
            chinese_tag: '视频',
            comments_count: 7,
            behot_time: 1784375050,
            source_url: '/group/7663270543809937946/',
            image_url: '//p3.pstatp.com/list/x.webp',
        }, 0);

        expect(row).toEqual({
            rank: 1,
            group_id: '7663270543809937946',
            title: 'T',
            abstract: 'A',
            source: 'S',
            tag: '视频',
            comments: 7,
            published_at: '2026-07-18T11:44:10Z',
            url: 'https://www.toutiao.com/group/7663270543809937946/',
            image_url: 'https://p3.pstatp.com/list/x.webp',
        });
    });

    it('drops sponsored rows and rows without a title', () => {
        expect(mapRecommendRow({ is_feed_ad: true, title: 'Ad', group_id: '1' }, 0)).toBeNull();
        expect(mapRecommendRow({ title: '   ', group_id: '1' }, 0)).toBeNull();
        expect(mapRecommendRow(null, 0)).toBeNull();
    });

    it('keeps missing counts and timestamps null instead of coercing to 0', () => {
        const row = mapRecommendRow({ group_id: '1', title: 'T' }, 0);
        expect(row.comments).toBeNull();
        expect(row.published_at).toBeNull();
        expect(row.abstract).toBeNull();
        expect(row.tag).toBeNull();
        expect(row.url).toBe('https://www.toutiao.com/group/1/');
    });

    it('derives group_id from first-party source_url when the explicit id is absent', () => {
        const row = mapRecommendRow({ title: 'T', source_url: '/group/12345/' }, 0);

        expect(row.group_id).toBe('12345');
        expect(row.url).toBe('https://www.toutiao.com/group/12345/');
    });

    it('typed-fails malformed article identity instead of emitting partial rows', () => {
        expect(() => mapRecommendRow({ title: 'T' }, 0)).toThrow(CommandExecutionError);
        expect(() => mapRecommendRow({ title: 'T', group_id: '../bad' }, 0)).toThrow(CommandExecutionError);
        expect(() => mapRecommendRow({ title: 'T', source_url: 'https://evil.example/group/1/' }, 0))
            .toThrow(CommandExecutionError);
        expect(() => mapRecommendRow({ group_id: '1', title: 'T', source_url: '/group/2/' }, 0))
            .toThrow(CommandExecutionError);
    });
});
