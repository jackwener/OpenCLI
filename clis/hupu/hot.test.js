// Hupu hot adapter — contract + JSDOM-against-frozen-fixture tests.
//
// Why a frozen-HTML fixture: the legacy adapter used a
// `documentElement.outerHTML` regex that would silently miss rows when
// hupu nudged whitespace or attribute order. Testing against a slim
// captured fixture in JSDOM proves the new querySelectorAll-based
// extractor handles the real markup shape — a mocked `page.evaluate()`
// alone cannot catch in-browser DOM bugs (lesson from dianping #1312
// → #1313).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    HOT_LIMIT_DEFAULT,
    HOT_LIMIT_MAX,
    extractHupuHotRowsFromDoc,
    hotCommand,
    normalizeHotLimit,
    parseHupuCount,
    __test__,
} from './hot.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOT_FIXTURE = readFileSync(join(__dirname, '__fixtures__/hot-home.html'), 'utf8');

describe('hupu/hot — registration', () => {
    it('registers as PUBLIC + browser:true with the new column shape', () => {
        const cmd = getRegistry().get('hupu/hot');
        expect(cmd).toBe(hotCommand);
        expect(cmd.browser).toBe(true);
        expect(cmd.strategy).toBe('public');
        expect(cmd.access).toBe('read');
        expect(cmd.domain).toBe('bbs.hupu.com');
        expect(cmd.columns).toEqual(['rank', 'tid', 'title', 'lights', 'replies', 'forum', 'is_hot', 'url']);
    });
});

describe('hupu/hot — normalizeHotLimit', () => {
    it('returns default when raw is missing / empty', () => {
        expect(normalizeHotLimit(undefined)).toBe(HOT_LIMIT_DEFAULT);
        expect(normalizeHotLimit(null)).toBe(HOT_LIMIT_DEFAULT);
        expect(normalizeHotLimit('')).toBe(HOT_LIMIT_DEFAULT);
    });

    it('accepts integer-coerceable values inside the cap', () => {
        expect(normalizeHotLimit(1)).toBe(1);
        expect(normalizeHotLimit('20')).toBe(20);
        expect(normalizeHotLimit(HOT_LIMIT_MAX)).toBe(HOT_LIMIT_MAX);
    });

    it('throws ArgumentError on out-of-range / non-integer / non-numeric — no silent clamp', () => {
        expect(() => normalizeHotLimit(0)).toThrow(ArgumentError);
        expect(() => normalizeHotLimit(-1)).toThrow(ArgumentError);
        expect(() => normalizeHotLimit(HOT_LIMIT_MAX + 1)).toThrow(ArgumentError);
        expect(() => normalizeHotLimit(1.5)).toThrow(ArgumentError);
        expect(() => normalizeHotLimit('not-a-number')).toThrow(ArgumentError);
    });
});

describe('hupu/hot — parseHupuCount', () => {
    it('parses base counts', () => {
        expect(parseHupuCount('50亮')).toBe(50);
        expect(parseHupuCount('359回复')).toBe(359);
        expect(parseHupuCount('0亮')).toBe(0);
    });

    it('expands 万 multiplier', () => {
        expect(parseHupuCount('1.2万亮')).toBe(12000);
        expect(parseHupuCount('5.8万回复')).toBe(58000);
        expect(parseHupuCount('1万')).toBe(10000);
    });

    it('returns null for missing / unparseable input — never 0 as unknown sentinel', () => {
        expect(parseHupuCount(null)).toBeNull();
        expect(parseHupuCount(undefined)).toBeNull();
        expect(parseHupuCount('')).toBeNull();
        expect(parseHupuCount('   ')).toBeNull();
        expect(parseHupuCount('abc')).toBeNull();
    });
});

describe('hupu/hot — extractHupuHotRowsFromDoc against frozen fixture', () => {
    function loadDocument() {
        const dom = new JSDOM(HOT_FIXTURE, { url: 'https://bbs.hupu.com/' });
        return dom.window.document;
    }

    it('extracts all 6 fixture rows with full column shape (lights/replies/forum/is_hot)', () => {
        const doc = loadDocument();
        const rows = extractHupuHotRowsFromDoc(doc, 50, parseHupuCount);

        expect(rows).toHaveLength(6);
        expect(rows.some((row) => row.tid === '639999999')).toBe(false);
        // Row 0: hot row, ASCII counts
        expect(rows[0]).toEqual({
            rank: 1,
            tid: '639088523',
            title: '网友曝三亚4只皮皮虾收费1035，官方凌晨通报',
            lights: 50,
            replies: 359,
            forum: '步行街主干道',
            is_hot: true,
            url: 'https://bbs.hupu.com/639088523.html',
        });
        // Row 1: non-hot row — same forum, different is_hot
        expect(rows[1]).toMatchObject({ rank: 2, tid: '639095236', is_hot: false });
        // Row 2: 万 multiplier — covers 1.2万 → 12000, 5.8万 → 58000
        expect(rows[2]).toMatchObject({ rank: 3, tid: '639094866', lights: 12000, replies: 58000, is_hot: false });
        // Row 3: 0 is preserved as real 0, not coerced to null
        expect(rows[3]).toMatchObject({ rank: 4, tid: '639100001', lights: 0, replies: 0, is_hot: true });
        // Row 4: missing .t-lights span — null sentinel, never silent 0
        expect(rows[4]).toMatchObject({ rank: 5, tid: '639100002', lights: null, replies: 20, is_hot: false });
        // Row 5: forum varies — proves t-label resolution is per-row
        expect(rows[5]).toMatchObject({ rank: 6, tid: '639100003', forum: '国际足球', is_hot: true });
    });

    it('respects the limit cap (returns ≤ limit rows)', () => {
        const doc = loadDocument();
        expect(extractHupuHotRowsFromDoc(doc, 3, parseHupuCount)).toHaveLength(3);
        expect(extractHupuHotRowsFromDoc(doc, 1, parseHupuCount)).toHaveLength(1);
    });

    it('returns [] when the document has no .t-info containers (page wobble guard)', () => {
        const dom = new JSDOM('<html><body><div class="bbs-index-web"></div></body></html>', {
            url: 'https://bbs.hupu.com/',
        });
        const rows = extractHupuHotRowsFromDoc(dom.window.document, 20, parseHupuCount);
        expect(rows).toEqual([]);
    });

    it('skips rows whose href does not match /<9-digit>.html (silent partial guard)', () => {
        const dom = new JSDOM(`
<html><body><div class="bbs-index-web">
  <div class="list-item-wrap"><div class="list-wrap"><div class="list-item">
    <div class="t-info">
      <a href="/forum/announcement"><span class="t-title">公告</span></a>
      <span class="t-lights">99亮</span><span class="t-replies">99回复</span>
    </div>
    <div class="t-label"><a>导航</a></div>
  </div></div></div>
  <div class="list-item-wrap"><div class="list-wrap"><div class="list-item">
    <div class="t-info">
      <a href="/639200001.html" class=" hot"><span class="t-title">真帖子</span></a>
      <span class="t-lights">5亮</span><span class="t-replies">3回复</span>
    </div>
    <div class="t-label"><a>板块</a></div>
  </div></div></div>
</div></body></html>`, { url: 'https://bbs.hupu.com/' });
        const rows = extractHupuHotRowsFromDoc(dom.window.document, 20, parseHupuCount);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tid: '639200001', is_hot: true });
    });
});

describe('hupu/hot — buildHotScript invariants', () => {
    it('embeds extractHupuHotRowsFromDoc + parseHupuCount via toString() and JSON.stringifies the limit', () => {
        const script = __test__.buildHotScript(7);
        expect(script).toContain('extractHupuHotRowsFromDoc');
        expect(script).toContain('parseHupuCount');
        expect(script).toContain('querySelectorAll');
        // Limit must be embedded literally (JSON.stringified) so the IIFE
        // can never be tricked into reading a parameter from the host page.
        expect(script).toContain(', 7, parseHupuCount');
    });

    it('does NOT use document.documentElement.outerHTML regex (anti-pattern guard)', () => {
        const script = __test__.buildHotScript(20);
        expect(script).not.toContain('documentElement.outerHTML');
        expect(script).not.toMatch(/regex\.exec/);
    });
});

describe('hupu/hot — getHupuHot func wiring', () => {
    function createPageMock(rows) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(rows),
        };
    }

    function createFailingPageMock(error) {
        return {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockRejectedValue(error),
        };
    }

    it('validates --limit upfront BEFORE calling page.goto (no wasted navigation)', async () => {
        const page = createPageMock([]);
        await expect(hotCommand.func(page, { limit: 0 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when the page returns an empty row list', async () => {
        const page = createPageMock([]);
        await expect(hotCommand.func(page, { limit: 20 })).rejects.toThrow(EmptyResultError);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('wraps page.evaluate failures as CommandExecutionError', async () => {
        const page = createFailingPageMock(new Error('selector crashed'));
        await expect(hotCommand.func(page, { limit: 20 })).rejects.toThrow(CommandExecutionError);
        expect(page.goto).toHaveBeenCalledTimes(1);
    });

    it('returns the rows verbatim when the in-page extractor yields data', async () => {
        const fakeRow = {
            rank: 1, tid: '639000001', title: 'demo', lights: 1, replies: 2,
            forum: '测试', is_hot: true, url: 'https://bbs.hupu.com/639000001.html',
        };
        const page = createPageMock([fakeRow]);
        const result = await hotCommand.func(page, { limit: 20 });
        expect(result).toEqual([fakeRow]);
        expect(page.goto).toHaveBeenCalledWith('https://bbs.hupu.com/', expect.objectContaining({
            waitUntil: 'load',
        }));
    });
});
