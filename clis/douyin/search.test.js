import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    extractDouyinVideoId,
    MAX_SEARCH_LIMIT,
    normalizeDouyinVideoUrl,
    parseDouyinCount,
    parseSearchLimit,
    projectCard,
    projectSearchCards,
} from './search.js';

function createPageMock({ evaluateResult } = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('douyin search', () => {
    it('registers the command on www.douyin.com', () => {
        const registry = getRegistry();
        const cmd = [...registry.values()].find((c) => c.site === 'douyin' && c.name === 'search');
        expect(cmd).toBeDefined();
        expect(cmd?.domain).toBe('www.douyin.com');
    });

    it('rejects invalid limit before navigation', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock();
        await expect(cmd.func(page, { query: '咖啡', limit: 0 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('--limit'),
        });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects limit above MAX_SEARCH_LIMIT', () => {
        expect(() => parseSearchLimit(MAX_SEARCH_LIMIT + 1)).toThrow(/--limit/);
    });

    it('rejects an empty query', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock();
        await expect(cmd.func(page, { query: '   ', limit: 5 })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('returns ranked cards from the rendered scroll-list', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({
            evaluateResult: {
                state: 'rendered',
                cards: [
                    {
                        url: '//www.douyin.com/video/7585120459717365001',
                        leafTexts: [
                            '合集',
                            '03:55',
                            '1.9万',
                            'Python邪修，5分钟学完Python基础 #python #编程',
                            '@',
                            '校长讲python（无小号）',
                            '5月前',
                        ],
                    },
                ],
            },
        });
        const rows = await cmd.func(page, { query: 'python', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.douyin.com/search/python?type=video');
        expect(rows).toEqual([
            {
                rank: 1,
                desc: 'Python邪修，5分钟学完Python基础 #python #编程',
                author: '校长讲python（无小号）',
                url: 'https://www.douyin.com/video/7585120459717365001',
                plays: 0,
                likes: 19000,
                comments: 0,
                shares: 0,
            },
        ]);
    });

    it('encodes Chinese keywords in the URL path', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: { state: 'rendered', cards: [{ url: '/video/1', leafTexts: ['hi'] }] } });
        await cmd.func(page, { query: 'AI 编程', limit: 1 });
        expect(page.goto).toHaveBeenCalledWith('https://www.douyin.com/search/AI%20%E7%BC%96%E7%A8%8B?type=video');
    });

    it('respects --limit cap when the page rendered more cards than requested', async () => {
        const cmd = getRegistry().get('douyin/search');
        const cards = Array.from({ length: 12 }, (_, i) => ({
            url: `//www.douyin.com/video/100000${i}`,
            leafTexts: ['03:00', `${i + 1}万`, `video ${i}`, '@', `user${i}`],
        }));
        const page = createPageMock({ evaluateResult: { state: 'rendered', cards } });
        const rows = await cmd.func(page, { query: 'x', limit: 3 });
        expect(rows).toHaveLength(3);
        expect(rows.map((r) => r.url)).toEqual([
            'https://www.douyin.com/video/1000000',
            'https://www.douyin.com/video/1000001',
            'https://www.douyin.com/video/1000002',
        ]);
    });

    it('maps the explicit login-wall state to AuthRequiredError', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: { state: 'login_wall' } });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: expect.stringContaining('login wall'),
        });
    });

    it('maps explicit empty search state to EmptyResultError', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: { state: 'empty' } });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });

    it('maps timeout state to CommandExecutionError instead of treating parser drift as auth or empty', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: { state: 'timeout' } });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });

    it('unwraps Browser Bridge {session, data} envelopes before inspecting state', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({
            evaluateResult: {
                session: 'site:douyin',
                data: { state: 'rendered', cards: [{ url: '/video/9', leafTexts: ['demo'] }] },
            },
        });
        const rows = await cmd.func(page, { query: 'x', limit: 1 });
        expect(rows).toHaveLength(1);
        expect(rows[0].url).toBe('https://www.douyin.com/video/9');
    });

    it('throws CommandExecutionError on malformed evaluator payload', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: 'not-an-object' });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });

    it('throws CommandExecutionError on malformed cards payload', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({ evaluateResult: { state: 'rendered', cards: { bad: true } } });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });

    it('fails closed instead of partially returning cards missing stable url or desc', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({
            evaluateResult: {
                state: 'rendered',
                cards: [
                    { url: '/video/123', leafTexts: ['03:00', 'valid desc'] },
                    { url: 'https://evil.test/video/456', leafTexts: ['03:00', 'invalid url'] },
                ],
            },
        });
        await expect(cmd.func(page, { query: 'x', limit: 2 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });

    it('fails closed when a card only has metadata text and no stable desc', async () => {
        const cmd = getRegistry().get('douyin/search');
        const page = createPageMock({
            evaluateResult: {
                state: 'rendered',
                cards: [
                    { url: '/video/123', leafTexts: ['合集', '03:00', '1.2万', '@', '作者名', '5月前'] },
                ],
            },
        });
        await expect(cmd.func(page, { query: 'x', limit: 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
        });
    });
});

describe('parseDouyinCount', () => {
    it.each([
        ['1.9万', 19_000],
        ['3万', 30_000],
        ['4702', 4702],
        ['1,234', 1234],
        ['1.2亿', 120_000_000],
        ['', 0],
        ['unknown', 0],
        [null, 0],
        [undefined, 0],
    ])('parses %j as %i', (input, expected) => {
        expect(parseDouyinCount(input)).toBe(expected);
    });
});

describe('normalizeDouyinVideoUrl', () => {
    it.each([
        ['//www.douyin.com/video/123', 'https://www.douyin.com/video/123'],
        ['/video/123?foo=bar', 'https://www.douyin.com/video/123'],
        ['https://www.douyin.com/video/123?something', 'https://www.douyin.com/video/123'],
        ['https://evil.test/video/123', ''],
        ['https://www.douyin.com/user/video/123', ''],
        ['', ''],
        [null, ''],
    ])('normalizes %j → %j', (input, expected) => {
        expect(normalizeDouyinVideoUrl(input)).toBe(expected);
    });

    it('extracts only stable Douyin video ids', () => {
        expect(extractDouyinVideoId('https://www.douyin.com/video/123')).toBe('123');
        expect(extractDouyinVideoId('//www.douyin.com/video/456')).toBe('456');
        expect(extractDouyinVideoId('https://evil.test/video/123')).toBe('');
    });
});

describe('projectCard', () => {
    it('extracts duration/likes/desc/author by leaf-text shape, classname-agnostic', () => {
        const row = projectCard({
            url: '//www.douyin.com/video/7585120459717365001',
            leafTexts: ['合集', '03:55', '1.9万', 'Python邪修', '@', '校长', '5月前'],
        }, 0);
        expect(row).toEqual({
            rank: 1,
            desc: 'Python邪修',
            author: '校长',
            url: 'https://www.douyin.com/video/7585120459717365001',
            plays: 0,
            likes: 19000,
            comments: 0,
            shares: 0,
        });
    });

    it('returns the longest non-skipped text as desc, not the publish-date suffix', () => {
        const row = projectCard({
            url: '/video/1',
            leafTexts: ['02:00', '4702', 'hi long-text', '@', 'user', '1月前'],
        }, 0);
        expect(row.desc).toBe('hi long-text');
        expect(row.author).toBe('user');
    });

    it('strips a fused @author prefix from the desc when present', () => {
        const row = projectCard({
            url: '/video/1',
            leafTexts: ['02:00', '100', '@alice this is the caption', '@', 'alice'],
        }, 0);
        expect(row.author).toBe('alice');
        expect(row.desc).toBe('this is the caption');
    });

    it('returns safe defaults when leafTexts is missing', () => {
        const row = projectCard({ url: '/video/42', leafTexts: undefined }, 4);
        expect(row).toEqual({
            rank: 5,
            desc: '',
            author: '',
            url: 'https://www.douyin.com/video/42',
            plays: 0,
            likes: 0,
            comments: 0,
            shares: 0,
        });
    });

    it('returns rank=index+1 regardless of input', () => {
        const row = projectCard({ url: '/video/1', leafTexts: ['x'] }, 9);
        expect(row.rank).toBe(10);
    });

    it('projects cards and reports malformed rows in the returned window', () => {
        const result = projectSearchCards([
            { url: '/video/1', leafTexts: ['caption'] },
            { url: '/video/not-numeric', leafTexts: ['bad'] },
            { url: '/video/3', leafTexts: [] },
        ], 3);
        expect(result.rows).toHaveLength(1);
        expect(result.invalidCount).toBe(2);
    });

    it('does not treat metadata-only leaf text as a stable desc', () => {
        const result = projectSearchCards([
            { url: '/video/1', leafTexts: ['合集', '03:55', '1.9万', '@', '校长', '5月前'] },
        ], 1);
        expect(result.rows).toHaveLength(0);
        expect(result.invalidCount).toBe(1);
    });
});
