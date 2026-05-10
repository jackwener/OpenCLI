// Xiaoe adapter contract + helper tests.
//
// The IIFEs walk Vue's private runtime tree (`__vue__`, `$store`,
// `$children`) which JSDOM cannot reproduce — testing the full IIFE
// against a frozen fixture is not viable here. Instead this file
// exercises:
//   1. The pure helpers each IIFE embeds via `${fn.toString()}` — these
//      are also called from JSDOM where the surface (URL building,
//      simple DOM walks) does work without a Vue runtime.
//   2. Each adapter's `func`-form wiring: upfront validation, typed
//      errors on empty results, rows passed through verbatim on the
//      happy path, no wasted `page.goto` on bad input.
//   3. The `build*Script` outputs: the embedded helpers must be
//      present, anti-patterns from the legacy adapters (silent column
//      drop, silent slice truncation) must NOT regress.

import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    CONTENT_SELECTORS,
    contentCommand,
    countXiaoeImages,
    pickContentText,
    requireXiaoePageUrl,
    __test__ as contentTest,
} from './content.js';
import {
    buildItemUrl,
    catalogCommand,
    chapterUrlPath,
    typeLabel,
    __test__ as catalogTest,
} from './catalog.js';
import {
    buildCourseUrl,
    coursesCommand,
    __test__ as coursesTest,
} from './courses.js';

// ─── Registration contract ──────────────────────────────────────────

describe('xiaoe — adapter registration', () => {
    it('content registers as cookie + browser, with the new full column shape', () => {
        const reg = getRegistry();
        expect(reg.get('xiaoe/content')).toBe(contentCommand);
        expect(contentCommand.browser).toBe(true);
        expect(contentCommand.strategy).toBe('cookie');
        expect(contentCommand.access).toBe('read');
        expect(contentCommand.domain).toBe('h5.xet.citv.cn');
        // `content` is the new column — restoring the silently-dropped
        // text the IIFE always extracted but the legacy `columns`
        // declaration discarded.
        expect(contentCommand.columns).toEqual([
            'title', 'content', 'content_length', 'image_count',
        ]);
    });

    it('catalog registers as cookie + browser, columns unchanged', () => {
        const reg = getRegistry();
        expect(reg.get('xiaoe/catalog')).toBe(catalogCommand);
        expect(catalogCommand.browser).toBe(true);
        expect(catalogCommand.strategy).toBe('cookie');
        expect(catalogCommand.access).toBe('read');
        expect(catalogCommand.columns).toEqual([
            'ch', 'chapter', 'no', 'title', 'type', 'resource_id', 'url', 'status',
        ]);
    });

    it('courses registers as cookie + browser, columns unchanged', () => {
        const reg = getRegistry();
        expect(reg.get('xiaoe/courses')).toBe(coursesCommand);
        expect(coursesCommand.browser).toBe(true);
        expect(coursesCommand.strategy).toBe('cookie');
        expect(coursesCommand.access).toBe('read');
        expect(coursesCommand.domain).toBe('study.xiaoe-tech.com');
        expect(coursesCommand.columns).toEqual(['title', 'shop', 'url']);
    });
});

// ─── content.js helpers ────────────────────────────────────────────

describe('xiaoe/content — pickContentText', () => {
    function htmlDoc(body) {
        return new JSDOM(`<html><body>${body}</body></html>`).window.document;
    }

    it('returns the first selector whose text exceeds the min-length threshold', () => {
        const doc = htmlDoc(`
            <div class="rich-text-wrap">${'a'.repeat(60)}</div>
            <div class="content-wrap">${'b'.repeat(120)}</div>
        `);
        const text = pickContentText(doc, CONTENT_SELECTORS, 50);
        expect(text.startsWith('a')).toBe(true);
        expect(text).toHaveLength(60);
    });

    it('skips selectors whose text is at or below the threshold (legacy used > 50)', () => {
        const doc = htmlDoc(`
            <div class="rich-text-wrap">${'a'.repeat(50)}</div>
            <div class="content-wrap">${'b'.repeat(120)}</div>
        `);
        const text = pickContentText(doc, CONTENT_SELECTORS, 50);
        expect(text.startsWith('b')).toBe(true);
    });

    it('falls back through main → #app → body when no selector qualifies', () => {
        const doc1 = htmlDoc(`<main>${'m'.repeat(80)}</main>`);
        expect(pickContentText(doc1, CONTENT_SELECTORS).startsWith('m')).toBe(true);

        const doc2 = htmlDoc(`<div id="app">${'p'.repeat(80)}</div>`);
        expect(pickContentText(doc2, CONTENT_SELECTORS).startsWith('p')).toBe(true);

        const doc3 = htmlDoc(`${'q'.repeat(80)}`);
        expect(pickContentText(doc3, CONTENT_SELECTORS).startsWith('q')).toBe(true);
    });

    it('returns "" when the body is genuinely empty (legitimate empty signal)', () => {
        const dom = new JSDOM('<html><body></body></html>');
        // Force the body to be missing (edge case JSDOM actually creates one)
        const doc = dom.window.document;
        // empty body → fallback chain returns ''
        expect(pickContentText(doc, CONTENT_SELECTORS)).toBe('');
    });
});

describe('xiaoe/content — countXiaoeImages', () => {
    function imgDoc(srcs) {
        const tags = srcs.map((s) => `<img src="${s}">`).join('');
        return new JSDOM(`<html><body>${tags}</body></html>`).window.document;
    }

    it('counts only xiaoe-hosted, non-data: images', () => {
        const doc = imgDoc([
            'https://commonresource-1252524126.cdn.xiaoe-tech.com/abc.jpg',
            'data:image/png;base64,iVBOR',
            'https://other-cdn.com/foo.jpg',
            'https://app.xiaoe-tech.com/img/bar.png',
        ]);
        expect(countXiaoeImages(doc)).toBe(2);
    });

    it('returns 0 when every image is excluded — never silently undefined', () => {
        const doc = imgDoc([
            'data:image/png;base64,xxx',
            'https://avatar.cdn.com/u.jpg',
        ]);
        expect(countXiaoeImages(doc)).toBe(0);
    });

    it('returns 0 on a doc with no <img> elements', () => {
        const doc = new JSDOM('<html><body><p>no images here</p></body></html>').window.document;
        expect(countXiaoeImages(doc)).toBe(0);
    });
});

describe('xiaoe/content — requireXiaoePageUrl', () => {
    it('rejects empty, malformed, and non-xiaoe URLs upfront', () => {
        expect(() => requireXiaoePageUrl('', 'content')).toThrow(ArgumentError);
        expect(() => requireXiaoePageUrl('not a url', 'content')).toThrow(ArgumentError);
        expect(() => requireXiaoePageUrl('http://h5.xet.citv.cn/p/course/ecourse/v_x', 'content')).toThrow(ArgumentError);
        expect(() => requireXiaoePageUrl('https://example.com/p/course/ecourse/v_x', 'content')).toThrow(ArgumentError);
    });

    it('accepts root and shop h5.xet.citv.cn URLs', () => {
        expect(requireXiaoePageUrl('https://h5.xet.citv.cn/p/course/ecourse/v_x', 'content'))
            .toBe('https://h5.xet.citv.cn/p/course/ecourse/v_x');
        expect(requireXiaoePageUrl('https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_x', 'content'))
            .toBe('https://appxxxx.h5.xet.citv.cn/p/course/ecourse/v_x');
    });
});

// ─── catalog.js helpers ────────────────────────────────────────────

describe('xiaoe/catalog — typeLabel', () => {
    it('maps known resource types to Chinese labels', () => {
        expect(typeLabel(1)).toBe('图文');
        expect(typeLabel(2)).toBe('直播');
        expect(typeLabel(3)).toBe('音频');
        expect(typeLabel(4)).toBe('视频');
        expect(typeLabel(6)).toBe('专栏');
        expect(typeLabel(8)).toBe('大专栏');
    });

    it('coerces string-typed resource type ints', () => {
        expect(typeLabel('1')).toBe('图文');
        expect(typeLabel('8')).toBe('大专栏');
    });

    it('returns the raw string for unknown types — never silently swallows', () => {
        expect(typeLabel(99)).toBe('99');
        expect(typeLabel('custom')).toBe('custom');
    });

    it('returns "" for nullish input (no falsy crash)', () => {
        expect(typeLabel(null)).toBe('');
        expect(typeLabel(undefined)).toBe('');
        expect(typeLabel(0)).toBe('');
    });
});

describe('xiaoe/catalog — buildItemUrl', () => {
    it('passes through fully-qualified URLs unchanged', () => {
        expect(buildItemUrl({ jump_url: 'https://example.com/x' }, 'https://h5.xet.citv.cn'))
            .toBe('https://example.com/x');
        expect(buildItemUrl({ h5_url: 'http://x.test/p' }, 'https://h5.xet.citv.cn'))
            .toBe('http://x.test/p');
    });

    it('prepends origin to relative URLs', () => {
        expect(buildItemUrl({ jump_url: '/p/123' }, 'https://h5.xet.citv.cn'))
            .toBe('https://h5.xet.citv.cn/p/123');
    });

    it('falls through jump_url → h5_url → url priority', () => {
        expect(buildItemUrl({ jump_url: '/a', h5_url: '/b', url: '/c' }, 'https://x.test'))
            .toBe('https://x.test/a');
        expect(buildItemUrl({ h5_url: '/b', url: '/c' }, 'https://x.test'))
            .toBe('https://x.test/b');
        expect(buildItemUrl({ url: '/c' }, 'https://x.test'))
            .toBe('https://x.test/c');
    });

    it('returns "" when no URL field is present (no synthetic URL)', () => {
        expect(buildItemUrl({}, 'https://x.test')).toBe('');
        expect(buildItemUrl({ jump_url: '' }, 'https://x.test')).toBe('');
    });
});

describe('xiaoe/catalog — chapterUrlPath', () => {
    it('returns the right path for known chapter types', () => {
        expect(chapterUrlPath(1)).toBe('/v1/course/text/');
        expect(chapterUrlPath(2)).toBe('/v2/course/alive/');
        expect(chapterUrlPath(3)).toBe('/v1/course/audio/');
        expect(chapterUrlPath(4)).toBe('/v1/course/video/');
    });

    it('coerces string ints', () => {
        expect(chapterUrlPath('1')).toBe('/v1/course/text/');
    });

    it('returns undefined for unknown / nullish — caller decides empty-URL semantics', () => {
        expect(chapterUrlPath(99)).toBeUndefined();
        expect(chapterUrlPath(0)).toBeUndefined();
        expect(chapterUrlPath(null)).toBeUndefined();
    });
});

// ─── courses.js helper ─────────────────────────────────────────────

describe('xiaoe/courses — buildCourseUrl', () => {
    it('returns h5_url when present (highest priority)', () => {
        expect(buildCourseUrl({
            h5_url: 'https://h5.xet.citv.cn/p/abc',
            app_id: 'appXXX',
            resource_id: 'p_999',
        })).toBe('https://h5.xet.citv.cn/p/abc');
    });

    it('returns url when h5_url missing', () => {
        expect(buildCourseUrl({ url: 'https://study.xiaoe-tech.com/u/y' }))
            .toBe('https://study.xiaoe-tech.com/u/y');
    });

    it('builds column path for resource_type 6', () => {
        expect(buildCourseUrl({
            app_id: 'appAAA',
            resource_id: 'p_111',
            resource_type: 6,
        })).toBe('https://appAAA.h5.xet.citv.cn/v1/course/column/p_111?type=3');
    });

    it('builds ecourse path for non-column types', () => {
        expect(buildCourseUrl({
            app_id: 'appAAA',
            resource_id: 'p_222',
            resource_type: 4,
        })).toBe('https://appAAA.h5.xet.citv.cn/p/course/ecourse/p_222');
    });

    it('returns "" when entry has no URL fields and no app_id+resource_id pair (no synthetic URL)', () => {
        expect(buildCourseUrl({})).toBe('');
        expect(buildCourseUrl({ app_id: 'x' })).toBe(''); // missing resource_id
        expect(buildCourseUrl({ resource_id: 'p_1' })).toBe(''); // missing app_id
        expect(buildCourseUrl(null)).toBe('');
        expect(buildCourseUrl(undefined)).toBe('');
    });
});

// ─── buildScript invariants (anti-pattern regression guards) ──────

describe('xiaoe — buildScript embeds helpers + no anti-patterns', () => {
    it('content script embeds pickContentText + countXiaoeImages and never silently slices images', () => {
        const script = contentTest.buildContentScript();
        expect(script).toContain('pickContentText');
        expect(script).toContain('countXiaoeImages');
        // The legacy adapter did `images.slice(0, 20)` and silently
        // dropped everything past the 20th image. The new script
        // exposes only `image_count` (counting all images via the
        // helper), so a hard `.slice(0, 20)` should not appear.
        expect(script).not.toMatch(/\.slice\(0,\s*20\)/);
        // Embeds the selector list literally so the IIFE has no
        // dependency on the host page's globals.
        expect(script).toContain('rich-text-wrap');
    });

    it('catalog script embeds typeLabel + buildItemUrl + chapterUrlPath', () => {
        const script = catalogTest.buildCatalogScript();
        expect(script).toContain('typeLabel');
        expect(script).toContain('buildItemUrl');
        expect(script).toContain('chapterUrlPath');
        // Vue private API anchors must remain — these are the only
        // stable hook into Xiaoe's SPA. If a future refactor removes
        // them, the test will fail and force a deliberate decision.
        expect(script).toContain('__vue__');
        expect(script).toContain('$store');
    });

    it('courses script embeds buildCourseUrl', () => {
        const script = coursesTest.buildCoursesScript();
        expect(script).toContain('buildCourseUrl');
        expect(script).toContain('__vue__');
    });
});

// ─── Wire tests for the func form ─────────────────────────────────

describe('xiaoe/content — getXiaoeContent func wiring', () => {
    function pageMock(rows) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(rows),
        };
    }

    it('throws ArgumentError on missing url BEFORE calling page.goto', async () => {
        const page = pageMock([]);
        await expect(contentCommand.func(page, {})).rejects.toThrow(ArgumentError);
        await expect(contentCommand.func(page, { url: '' })).rejects.toThrow(ArgumentError);
        await expect(contentCommand.func(page, { url: '   ' })).rejects.toThrow(ArgumentError);
        await expect(contentCommand.func(page, { url: 'https://example.com/p/x' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('wraps browser navigation failures as CommandExecutionError', async () => {
        const page = {
            goto: vi.fn().mockRejectedValue(new Error('net::ERR_ABORTED')),
            evaluate: vi.fn(),
        };
        await expect(contentCommand.func(page, { url: 'https://h5.xet.citv.cn/p/x' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when no rows are returned', async () => {
        const page = pageMock([]);
        await expect(contentCommand.func(page, { url: 'https://h5.xet.citv.cn/p/x' }))
            .rejects.toThrow(EmptyResultError);
    });

    it('throws EmptyResultError when content is empty (login likely expired — fail-fast not silent empty row)', async () => {
        const page = pageMock([{ title: 'shell', content: '', content_length: 0, image_count: 0 }]);
        await expect(contentCommand.func(page, { url: 'https://h5.xet.citv.cn/p/x' }))
            .rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when page.evaluate rejects', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockRejectedValue(new Error('CDP exploded')),
        };
        await expect(contentCommand.func(page, { url: 'https://h5.xet.citv.cn/p/x' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('returns the rows verbatim on the happy path', async () => {
        const fakeRow = {
            title: 'demo',
            content: 'hello world '.repeat(10),
            content_length: 120,
            image_count: 3,
        };
        const page = pageMock([fakeRow]);
        const result = await contentCommand.func(page, { url: 'https://h5.xet.citv.cn/p/x' });
        expect(result).toEqual([fakeRow]);
        expect(page.goto).toHaveBeenCalledWith(
            'https://h5.xet.citv.cn/p/x',
            expect.objectContaining({ waitUntil: 'load' }),
        );
    });
});

describe('xiaoe/catalog — getXiaoeCatalog func wiring', () => {
    function pageMock(rows) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(rows),
        };
    }

    it('throws ArgumentError on missing url BEFORE calling page.goto', async () => {
        const page = pageMock([]);
        await expect(catalogCommand.func(page, {})).rejects.toThrow(ArgumentError);
        await expect(catalogCommand.func(page, { url: 'https://example.com/p/c' })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('wraps browser navigation failures as CommandExecutionError', async () => {
        const page = {
            goto: vi.fn().mockRejectedValue(new Error('Execution context was destroyed')),
            evaluate: vi.fn(),
        };
        await expect(catalogCommand.func(page, { url: 'https://h5.xet.citv.cn/p/c' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when no chapters extracted (cookie likely expired)', async () => {
        const page = pageMock([]);
        await expect(catalogCommand.func(page, { url: 'https://h5.xet.citv.cn/p/c' }))
            .rejects.toThrow(EmptyResultError);
    });

    it('returns rows verbatim on the happy path', async () => {
        const fake = [{
            ch: 1, chapter: '入门', no: 1, title: '第一节',
            type: '视频', resource_id: 'v_abc', url: 'https://x.test/v/abc', status: '未学',
        }];
        const page = pageMock(fake);
        expect(await catalogCommand.func(page, { url: 'https://h5.xet.citv.cn/p/c' }))
            .toEqual(fake);
    });

    it('throws CommandExecutionError when page.evaluate rejects', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockRejectedValue(new Error('boom')),
        };
        await expect(catalogCommand.func(page, { url: 'https://h5.xet.citv.cn/p/c' }))
            .rejects.toThrow(CommandExecutionError);
    });
});

describe('xiaoe/courses — getXiaoeCourses func wiring', () => {
    function pageMock(rows) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(rows),
        };
    }

    it('navigates to the study landing page (no positional arg required)', async () => {
        const fake = [{ title: 'Course A', shop: 'Shop A', url: 'https://x.test/c/a' }];
        const page = pageMock(fake);
        const result = await coursesCommand.func(page, {});
        expect(page.goto).toHaveBeenCalledWith(
            'https://study.xiaoe-tech.com/',
            expect.objectContaining({ waitUntil: 'load' }),
        );
        expect(result).toEqual(fake);
    });

    it('throws EmptyResultError when no cards found (cookie likely expired)', async () => {
        const page = pageMock([]);
        await expect(coursesCommand.func(page, {})).rejects.toThrow(EmptyResultError);
    });

    it('throws CommandExecutionError when page.evaluate rejects', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockRejectedValue(new Error('cdp')),
        };
        await expect(coursesCommand.func(page, {})).rejects.toThrow(CommandExecutionError);
    });

    it('wraps browser navigation failures as CommandExecutionError', async () => {
        const page = {
            goto: vi.fn().mockRejectedValue(new Error('net::ERR_ABORTED')),
            evaluate: vi.fn(),
        };
        await expect(coursesCommand.func(page, {})).rejects.toThrow(CommandExecutionError);
    });
});
