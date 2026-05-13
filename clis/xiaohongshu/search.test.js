import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import { __test__, buildScrollUntilJs, noteIdToDate } from './search.js';

function markVisible(el) {
    el.getBoundingClientRect = () => ({ width: 100, height: 100 });
}
function createPageMock(evaluateResults) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) {
        evaluate.mockResolvedValueOnce(result);
    }
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate,
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}
describe('xiaohongshu search', () => {
    it('rejects invalid limit before browser navigation', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        const page = createPageMock([]);

        await expect(cmd.func(page, { query: '特斯拉', limit: 0 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('--limit'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws a clear error when the search page is blocked by a login wall', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (login wall detected)
            'login_wall',
        ]);
        await expect(cmd.func(page, { query: '特斯拉', limit: 5 })).rejects.toThrow('Xiaohongshu search results are blocked behind a login wall');
        // No scroll-until / autoScroll call when a login wall is detected early.
        expect(page.evaluate).toHaveBeenCalledTimes(1);
        expect(page.autoScroll).not.toHaveBeenCalled();
    });
    it('returns ranked results with search_result url and author_url preserved', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const detailUrl = 'https://www.xiaohongshu.com/search_result/68e90be80000000004022e66?xsec_token=test-token&xsec_source=';
        const authorUrl = 'https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40?xsec_token=user-token&xsec_source=pc_search';
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll-until-enough (returns final note count)
            1,
            // Third evaluate: main DOM extraction (returns array directly)
            [
                {
                    title: '某鱼买FSD被坑了4万',
                    author: '随风',
                    likes: '261',
                    url: detailUrl,
                    author_url: authorUrl,
                },
            ],
        ]);
        const result = await cmd.func(page, { query: '特斯拉', limit: 1 });
        // Should only do one goto (the search page itself), no per-note detail navigation
        expect(page.goto.mock.calls).toHaveLength(1);
        expect(result).toEqual([
            {
                rank: 1,
                title: '某鱼买FSD被坑了4万',
                author: '随风',
                likes: '261',
                published_at: '2025-10-10',
                url: detailUrl,
                author_url: authorUrl,
            },
        ]);
    });
    it('filters out results with no title and respects the limit', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll-until-enough (returns final note count)
            3,
            // Third evaluate: main DOM extraction (returns array directly)
            [
                {
                    title: 'Result A',
                    author: 'UserA',
                    likes: '10',
                    url: 'https://www.xiaohongshu.com/search_result/aaa',
                    author_url: '',
                },
                {
                    title: '',
                    author: 'UserB',
                    likes: '5',
                    url: 'https://www.xiaohongshu.com/search_result/bbb',
                    author_url: '',
                },
                {
                    title: 'Result C',
                    author: 'UserC',
                    likes: '3',
                    url: 'https://www.xiaohongshu.com/search_result/ccc',
                    author_url: '',
                },
            ],
        ]);
        const result = (await cmd.func(page, { query: '测试', limit: 1 }));
        // limit=1 should return only the first valid-titled result
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ rank: 1, title: 'Result A' });
    });
    it('waits for content via MutationObserver before extracting', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const page = createPageMock([
            // First evaluate: MutationObserver wait (content appeared)
            'content',
            // Second evaluate: scroll-until-enough (no rows rendered)
            0,
            // Third evaluate: extraction (returns empty array)
            [],
        ]);
        const result = (await cmd.func(page, { query: '测试等待', limit: 5 }));
        expect(result).toHaveLength(0);
        // Only one navigation, no retry
        expect(page.goto).toHaveBeenCalledTimes(1);
        // Three evaluate calls: wait + scroll-until + extraction
        expect(page.evaluate).toHaveBeenCalledTimes(3);
    });
    it('separates fallback author text from appended relative date', async () => {
        const cmd = getRegistry().get('xiaohongshu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const dom = new JSDOM(`
          <section class="note-item">
            <a class="cover mask" href="/search_result/68e90be80000000004022e66?xsec_token=test-token"></a>
            <div class="title">数字作者测试</div>
            <a class="author" href="/user/profile/author123">
              <span>数字3天前端</span><span>3天前</span>
            </a>
            <span class="count">8</span>
          </section>
        `, { url: 'https://www.xiaohongshu.com/search_result?keyword=test' });
        markVisible(dom.window.document.querySelector('section.note-item'));
        const page = createPageMock([]);
        page.evaluate.mockImplementationOnce(async () => 'content');
        // scroll-until-enough returns the final visible row count
        page.evaluate.mockImplementationOnce(async () => 1);
        page.evaluate.mockImplementationOnce(async (script) => Function('document', 'getComputedStyle', `return (${script})`)(dom.window.document, dom.window.getComputedStyle.bind(dom.window)));

        const result = await cmd.func(page, { query: '测试', limit: 1 });

        expect(result[0]).toMatchObject({
            title: '数字作者测试',
            author: '数字3天前端',
            likes: '8',
            author_url: 'https://www.xiaohongshu.com/user/profile/author123',
        });
    });
});
describe('buildScrollUntilJs', () => {
    it('inlines the target count and default maxScrolls into the generated IIFE', () => {
        const js = buildScrollUntilJs(40);
        // Target count must drive the early-exit check (#1471: --limit > 13 was capped).
        expect(js).toContain('countItems() >= 40');
        // Default safety cap of 15 to bound runtime on infinite-scroll pages.
        expect(js).toContain('i < 15');
        // Plateau detection so the loop exits early when XHS stops lazy-loading
        // instead of spinning all 15 iterations against an exhausted feed.
        expect(js).toContain('plateauRounds');
        // Related-search rows must not count toward the target.
        expect(js).toContain("classList.contains('query-note-item')");
    });
    it('respects a custom maxScrolls override', () => {
        const js = buildScrollUntilJs(100, 5);
        expect(js).toContain('countItems() >= 100');
        expect(js).toContain('i < 5');
    });
    it('counts only visible real note rows', async () => {
        const dom = new JSDOM(`
          <section class="note-item" id="visible"></section>
          <section class="note-item query-note-item" id="query"></section>
          <section class="note-item" id="hidden" style="display:none"></section>
        `, { url: 'https://www.xiaohongshu.com/search_result?keyword=test' });
        markVisible(dom.window.document.querySelector('#visible'));
        markVisible(dom.window.document.querySelector('#query'));
        markVisible(dom.window.document.querySelector('#hidden'));

        const result = await Function('document', 'window', 'MutationObserver', 'getComputedStyle', `return (${buildScrollUntilJs(1)})`)(dom.window.document, dom.window, dom.window.MutationObserver, dom.window.getComputedStyle.bind(dom.window));

        expect(result).toBe(1);
    });
    it('rejects unsafe helper arguments instead of interpolating them into code', () => {
        expect(() => buildScrollUntilJs(0)).toThrow(/targetCount/);
        expect(() => buildScrollUntilJs(10, 0)).toThrow(/maxScrolls/);
    });
});
describe('stripXhsAuthorDateSuffix', () => {
    it('only strips trailing date suffixes and preserves date-like author text', () => {
        expect(__test__.stripXhsAuthorDateSuffix('作者名 3天前')).toBe('作者名');
        expect(__test__.stripXhsAuthorDateSuffix('作者名2026-04-01')).toBe('作者名');
        expect(__test__.stripXhsAuthorDateSuffix('3天前端工程师')).toBe('3天前端工程师');
        expect(__test__.stripXhsAuthorDateSuffix('刚刚好')).toBe('刚刚好');
        expect(__test__.stripXhsAuthorDateSuffix('刚刚')).toBe('刚刚');
    });
});
describe('noteIdToDate (ObjectID timestamp parsing)', () => {
    it('parses a known note ID to the correct China-timezone date', () => {
        // 0x697f6c74 = 1769958516 → 2026-02-01 in UTC+8
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/697f6c74000000002103de17')).toBe('2026-02-01');
        // 0x68e90be8 → 2025-10-10 in UTC+8
        expect(noteIdToDate('https://www.xiaohongshu.com/explore/68e90be80000000004022e66')).toBe('2025-10-10');
    });
    it('returns China date when UTC+8 crosses into the next day', () => {
        // 0x69b739f0 = 2026-03-15 23:00 UTC = 2026-03-16 07:00 CST
        // Without UTC+8 offset this would incorrectly return 2026-03-15
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/69b739f00000000000000000')).toBe('2026-03-16');
    });
    it('handles /note/ path variant', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/note/697f6c74000000002103de17')).toBe('2026-02-01');
    });
    it('handles URL with query parameters', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/697f6c74000000002103de17?xsec_token=abc')).toBe('2026-02-01');
    });
    it('returns empty string for non-matching URLs', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40')).toBe('');
        expect(noteIdToDate('https://www.xiaohongshu.com/')).toBe('');
    });
    it('returns empty string for IDs shorter than 24 hex chars', () => {
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/abcdef')).toBe('');
    });
    it('returns empty string when timestamp is out of range', () => {
        // All zeros → ts = 0
        expect(noteIdToDate('https://www.xiaohongshu.com/search_result/000000000000000000000000')).toBe('');
    });
});
