import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { extractSearchRows } from './search.js';
import { extractRecentRows } from './recent.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_FIXTURE = readFileSync(join(__dirname, '__fixtures__/search.html'), 'utf8');
const RECENT_FIXTURE = readFileSync(join(__dirname, '__fixtures__/recent.html'), 'utf8');

function createPageMock(evaluateResult, overrides = {}) {
    const evaluate = typeof evaluateResult === 'function'
        ? vi.fn(evaluateResult)
        : vi.fn().mockResolvedValue(evaluateResult);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        ...overrides,
    };
}

describe('gov-policy commands — registration', () => {
    it('registers search and recent as public browser commands', () => {
        const search = getRegistry().get('gov-policy/search');
        const recent = getRegistry().get('gov-policy/recent');

        expect(search).toBeDefined();
        expect(recent).toBeDefined();
        expect(search.browser).toBe(true);
        expect(recent.browser).toBe(true);
        expect(search.strategy).toBe('public');
        expect(recent.strategy).toBe('public');
        expect(search.columns).toEqual(['rank', 'title', 'description', 'date', 'url']);
        expect(recent.columns).toEqual(['rank', 'title', 'date', 'source', 'url']);
    });

    it('rejects empty search queries before browser navigation', async () => {
        const search = getRegistry().get('gov-policy/search');
        const page = { goto: vi.fn() };
        await expect(search.func(page, { query: '   ' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('rejects invalid limits before browser navigation', async () => {
        const search = getRegistry().get('gov-policy/search');
        const recent = getRegistry().get('gov-policy/recent');
        const page = createPageMock({ ok: true, rows: [] });

        await expect(search.func(page, { query: '数字经济', limit: '0' })).rejects.toThrow(ArgumentError);
        await expect(search.func(page, { query: '数字经济', limit: '1.5' })).rejects.toThrow(ArgumentError);
        await expect(search.func(page, { query: '数字经济', limit: '21' })).rejects.toThrow(ArgumentError);
        await expect(recent.func(page, { limit: 'abc' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('maps empty search pages, selector drift, and browser failures to typed errors', async () => {
        const search = getRegistry().get('gov-policy/search');
        const recent = getRegistry().get('gov-policy/recent');

        await expect(search.func(createPageMock({
            ok: false,
            sample: '很抱歉，没有找到与 数字经济 相关的结果',
            url: 'https://sousuo.www.gov.cn/sousuo/search.shtml?searchWord=x',
        }), { query: '数字经济' })).rejects.toThrow(EmptyResultError);

        await expect(recent.func(createPageMock({
            ok: false,
            sample: '<main>unexpected government page shell</main>',
            url: 'https://www.gov.cn/zhengce/zuixin/index.htm',
        }), {})).rejects.toThrow(CommandExecutionError);

        await expect(search.func(createPageMock(
            { ok: true, rows: [] },
            { goto: vi.fn().mockRejectedValue(new Error('browser disconnected')) },
        ), { query: '数字经济' })).rejects.toThrow(CommandExecutionError);
    });
});

/**
 * In-browser DOM extractors against frozen sanitized HTML fixtures.
 *
 * Mocked-page.evaluate tests can't catch silent bugs that live inside the
 * extractor, since they feed pre-baked results to the func and the real
 * DOM walk never runs.
 *
 * These tests replay the real (sanitized) HTML through JSDOM so changes
 * to the extractor logic that re-introduce a silent regression fail in CI.
 */
describe('gov-policy adapter — extractors against frozen HTML fixtures', () => {
    let originalDocument;
    let originalLocation;

    beforeEach(() => {
        originalDocument = globalThis.document;
        originalLocation = globalThis.location;
    });

    afterEach(() => {
        globalThis.document = originalDocument;
        globalThis.location = originalLocation;
    });

    function loadFixture(html, url) {
        const dom = new JSDOM(html, { url });
        globalThis.document = dom.window.document;
        globalThis.location = dom.window.location;
        return dom;
    }

    it('extractSearchRows returns three result-shaped rows with title, description, date, url', () => {
        loadFixture(SEARCH_FIXTURE, 'https://sousuo.www.gov.cn/sousuo/search.shtml?searchWord=%E6%95%B0%E5%AD%97%E7%BB%8F%E6%B5%8E');

        const result = extractSearchRows();

        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(3);

        // Rank 1 + 3 are the homogeneous "type tag + emphasized title" cards
        // whose .description div carries only the date span (no real snippet).
        expect(result.rows[0]).toMatchObject({
            rank: 1,
            title: '要闻经济数据速览：10组数字看一季度中国经济',
            date: '2026-4-16',
            url: 'https://www.gov.cn/zhengce/jiedu/tujie/202604/content_7065945.htm',
        });
        // Description for these rows is just the publish-time line.
        expect(result.rows[0].description).toContain('发布时间');
        expect(result.rows[0].description).toContain('2026-4-16');

        // Rank 2 has a real article snippet inside .description > .detail > p,
        // and the extractor must capture it (sliced to 120 chars).
        expect(result.rows[1]).toMatchObject({
            rank: 2,
            title: '要闻何立峰会见法国经济、财政和工业、能源与数字主权部部长莱斯屈尔',
            date: '2026-3-17',
            url: 'https://www.gov.cn/yaowen/liebiao/202603/content_7062985.htm',
        });
        expect(result.rows[1].description.length).toBeLessThanOrEqual(120);
        expect(result.rows[1].description).toContain('新华社巴黎');

        expect(result.rows[2]).toMatchObject({
            rank: 3,
            title: '要闻经济数据速览：7组数字看1—2月份中国经济',
            date: '2026-3-16',
            url: 'https://www.gov.cn/zhengce/jiedu/tujie/202603/content_7062831.htm',
        });

        // Lock the no-collapse contract on the title: the type_title prefix
        // ('要闻') is fused into the textContent because we read the whole <a>.
        // If a future refactor strips the prefix, this assertion catches it
        // before any field-level downstream surprises.
        for (const row of result.rows) {
            expect(row.title.startsWith('要闻')).toBe(true);
        }
    });

    it('extractRecentRows returns five rows with title, date, url and empty source', () => {
        loadFixture(RECENT_FIXTURE, 'https://www.gov.cn/zhengce/zuixin/index.htm');

        const result = extractRecentRows();

        expect(result.ok).toBe(true);
        expect(result.rows).toHaveLength(5);

        expect(result.rows[0]).toMatchObject({
            rank: 1,
            title: '中共中央办公厅 国务院办公厅关于加强新就业群体服务管理的意见',
            date: '2026-04-26',
            url: 'https://www.gov.cn/zhengce/202604/content_7066998.htm',
        });
        expect(result.rows[1]).toMatchObject({
            rank: 2,
            date: '2026-04-23',
        });
        expect(result.rows[4]).toMatchObject({
            rank: 5,
            date: '2026-04-17',
        });

        // gov.cn/zhengce/zuixin layout has no .source / .from elements, so
        // the source field is always an empty string. Lock that contract:
        // a future selector change that picks up unrelated text would break
        // it and fail this assertion.
        for (const row of result.rows) {
            expect(row.source).toBe('');
        }
    });

    it('extractSearchRows signals ok:false with a sample when result list is empty', () => {
        loadFixture(
            '<html><head><title>blocked</title></head><body><main>访问受限，请稍后再试</main></body></html>',
            'https://sousuo.www.gov.cn/sousuo/search.shtml?searchWord=zzz',
        );

        const result = extractSearchRows();

        expect(result.ok).toBe(false);
        expect(result.url).toBe('https://sousuo.www.gov.cn/sousuo/search.shtml?searchWord=zzz');
        expect(result.sample).toContain('访问受限');
    });

    it('extractRecentRows signals ok:false with a sample when listing is empty', () => {
        loadFixture(
            '<html><head><title>not found</title></head><body><main>页面正在加载</main></body></html>',
            'https://www.gov.cn/zhengce/zuixin/index.htm',
        );

        const result = extractRecentRows();

        expect(result.ok).toBe(false);
        expect(result.url).toBe('https://www.gov.cn/zhengce/zuixin/index.htm');
        expect(result.sample).toContain('页面正在加载');
    });
});
