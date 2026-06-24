/**
 * Unit tests for the 太平洋电脑网 (PConline) adapter.
 *
 * Every command GETs a GBK-encoded SSR page and parses it with regex, so the
 * pure parsers are exercised against frozen real-data fixtures captured from
 * product.pconline.com.cn (list = 手机大全; info/param = Apple Watch Ultra2,
 * smartwatch/apple/1943087). No network, no browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    LIST_COLUMNS,
    INFO_COLUMNS,
    PARAM_COLUMNS,
    clean,
    stripHtml,
    decodeEntities,
    requireLimit,
    normalizeProduct,
    productBase,
} from './utils.js';
import { parseListRows } from './list.js';
import { parseInfoRows } from './info.js';
import { parseParamRows } from './param.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const LIST = fx('list.html');
const INFO = fx('info.html');
const PARAM = fx('param.html');

describe('pconline list', () => {
    it('parses product cards with id / name / category / url', () => {
        const rows = parseListRows(LIST, 20);
        expect(rows.length).toBeGreaterThan(0);
        expect(Object.keys(rows[0])).toEqual(LIST_COLUMNS);
        const r = rows[0];
        expect(r.product_id).toMatch(/^\d+$/);
        expect(r.category).toBe('mobile');
        expect(r.name).toBeTruthy();
        expect(r.url).toMatch(/^https:\/\/product\.pconline\.com\.cn\/mobile\/[a-z0-9]+\/\d+\.html$/);
        // price is either a string with a digit/￥ or null (暂无报价)
        expect(r.price === null || /[￥¥\d]/.test(r.price)).toBe(true);
    });

    it('dedupes by product id and respects the limit', () => {
        const ids = parseListRows(LIST, 30).map((r) => r.product_id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(parseListRows(LIST, 3).length).toBeLessThanOrEqual(3);
    });

    it('returns [] for empty html (no throw)', () => {
        expect(parseListRows('', 20)).toEqual([]);
    });
});

describe('pconline info', () => {
    it('parses overview rows: 名称 / 分类 / 重点参数', () => {
        const rows = parseInfoRows(INFO);
        expect(rows.length).toBeGreaterThan(2);
        expect(Object.keys(rows[0])).toEqual(INFO_COLUMNS);
        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(byField['名称']).toContain('iPhone');
        expect(byField['分类']).toBe('手机');
        // at least one 重点参数 highlight (e.g. 屏幕分辨率) surfaced, and the
        // value is never just an echo of the field name
        expect(rows.some((r) => /分辨率|电池|功能|充电|系统/.test(r.field))).toBe(true);
        expect(rows.every((r) => r.field !== r.value)).toBe(true);
    });

    it('returns [] for empty html', () => {
        expect(parseInfoRows('')).toEqual([]);
    });
});

describe('pconline param', () => {
    it('parses spec field/value rows from the detail table', () => {
        const rows = parseParamRows(PARAM);
        expect(rows.length).toBeGreaterThan(5);
        expect(Object.keys(rows[0])).toEqual(PARAM_COLUMNS);
        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        // known iPhone17 Pro Max specs
        expect(byField['运行内存']).toMatch(/GB/);
        expect(byField['CPU品牌']).toBe('苹果');
        // values are flattened (no leftover tags) and the poptxt glossary
        // chrome ("…是什么 / 查看所有…", "点击型号查看完整天梯图") is stripped
        expect(rows.every((r) => !/[<>]/.test(r.value))).toBe(true);
        expect(rows.every((r) => !/查看所有|是什么|查看完整天梯图/.test(r.value))).toBe(true);
    });

    it('returns [] for empty html', () => {
        expect(parseParamRows('')).toEqual([]);
    });
});

describe('pconline utils', () => {
    it('normalizeProduct accepts URL and triple, rejects bare id', () => {
        expect(normalizeProduct('//product.pconline.com.cn/mobile/apple/2718819.html'))
            .toEqual({ category: 'mobile', brand: 'apple', id: '2718819' });
        expect(normalizeProduct('https://product.pconline.com.cn/smartwatch/apple/1943087_detail.html'))
            .toEqual({ category: 'smartwatch', brand: 'apple', id: '1943087' });
        expect(normalizeProduct('mobile/bubugao/2822031'))
            .toEqual({ category: 'mobile', brand: 'bubugao', id: '2822031' });
        expect(() => normalizeProduct('2718819')).toThrow();
        expect(() => normalizeProduct('')).toThrow();
    });

    it('productBase builds the canonical detail base', () => {
        expect(productBase({ category: 'mobile', brand: 'apple', id: '2718819' }))
            .toBe('https://product.pconline.com.cn/mobile/apple/2718819');
    });

    it('requireLimit clamps to [1, max]', () => {
        expect(requireLimit(undefined, 20, 60)).toBe(20);
        expect(requireLimit('5', 20, 60)).toBe(5);
        expect(() => requireLimit(0, 20, 60)).toThrow();
        expect(() => requireLimit(99, 20, 60)).toThrow();
    });

    it('clean / stripHtml / decodeEntities normalize text', () => {
        expect(clean('  a\n b ')).toBe('a b');
        expect(stripHtml('x<br>y &amp; <a>z</a>')).toBe('x / y & z');
        expect(decodeEntities('A&nbsp;B&#65;')).toBe('A BA');
    });
});

describe('pconline command registration', () => {
    it('registers list / info / param as PUBLIC read commands', () => {
        const reg = getRegistry();
        for (const name of ['list', 'info', 'param']) {
            const cmd = reg.get(`pconline/${name}`);
            expect(cmd, `pconline ${name} registered`).toBeTruthy();
            expect(cmd.strategy).toBe(Strategy.PUBLIC);
            expect(cmd.browser).toBe(false);
            expect(cmd.access).toBe('read');
        }
    });
});
