/**
 * Unit tests for the 中关村在线 (ZOL) adapter.
 *
 * Every command GETs a GBK-encoded SSR page and parses it with regex, so the
 * pure parsers are exercised against frozen real-data fixtures captured from
 * zol.com.cn (product 1427365 = 苹果 iPhone 15). No network, no browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    SEARCH_COLUMNS,
    PARAM_COLUMNS,
    PRICE_COLUMNS,
    clean,
    stripHtml,
    decodeEntities,
    requireLimit,
    normalizeProductId,
} from './utils.js';
import { parseSearchRows } from './search.js';
import { parseParamRows } from './param.js';
import { parsePriceRows } from './price.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const SEARCH = fx('search.html');
const PARAM = fx('param.html');
const PRICE = fx('price.html');

describe('zol search', () => {
    it('parses product rows with id / name / price / url', () => {
        const rows = parseSearchRows(SEARCH, 20);
        expect(rows.length).toBeGreaterThan(0);
        const ip = rows.find((r) => r.product_id === '1427365');
        expect(ip).toBeTruthy();
        expect(ip.name).toContain('iPhone 15');
        expect(ip.price).toMatch(/元/);
        expect(ip.url).toMatch(/^https:\/\/detail\.zol\.com\.cn\/.*index1427365\.shtml$/);
        expect(Object.keys(rows[0])).toEqual(SEARCH_COLUMNS);
    });

    it('dedupes by product id and respects the limit', () => {
        const ids = parseSearchRows(SEARCH, 20).map((r) => r.product_id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(parseSearchRows(SEARCH, 3).length).toBeLessThanOrEqual(3);
    });

    it('returns [] for empty html (no throw)', () => {
        expect(parseSearchRows('', 20)).toEqual([]);
    });
});

describe('zol param', () => {
    it('parses spec field/value rows', () => {
        const rows = parseParamRows(PARAM);
        expect(rows.length).toBeGreaterThan(5);
        expect(Object.keys(rows[0])).toEqual(PARAM_COLUMNS);
        const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(byField['长度']).toBe('146.7mm');
        expect(byField['重量']).toBe('171g');
    });

    it('returns [] for empty html', () => {
        expect(parseParamRows('')).toEqual([]);
    });
});

describe('zol price', () => {
    it('parses merchant offers with platform / seller / numeric price', () => {
        const rows = parsePriceRows(PRICE);
        expect(rows.length).toBeGreaterThan(0);
        expect(Object.keys(rows[0])).toEqual(PRICE_COLUMNS);
        const jd = rows.find((r) => r.platform === '京东');
        expect(jd).toBeTruthy();
        expect(typeof jd.price).toBe('number');
        expect(jd.price).toBeGreaterThan(0);
        expect(jd.seller).toBeTruthy();
    });

    it('returns [] for empty html', () => {
        expect(parsePriceRows('')).toEqual([]);
    });
});

describe('zol utils', () => {
    it('normalizeProductId accepts bare id, index URL and param URL', () => {
        expect(normalizeProductId('1427365')).toBe('1427365');
        expect(normalizeProductId('//detail.zol.com.cn/cell_phone/index1427365.shtml')).toBe('1427365');
        expect(normalizeProductId('https://detail.zol.com.cn/1428/1427365/param.shtml')).toBe('1427365');
        expect(() => normalizeProductId('not-an-id')).toThrow();
        expect(() => normalizeProductId('')).toThrow();
    });

    it('requireLimit clamps to [1, max]', () => {
        expect(requireLimit(undefined, 20, 40)).toBe(20);
        expect(requireLimit('5', 20, 40)).toBe(5);
        expect(() => requireLimit(0, 20, 40)).toThrow();
        expect(() => requireLimit(99, 20, 40)).toThrow();
    });

    it('clean / stripHtml / decodeEntities normalize text', () => {
        expect(clean('  a\n b ')).toBe('a b');
        expect(stripHtml('<b>x</b> &amp; <i>y</i>')).toBe('x & y');
        expect(decodeEntities('A&nbsp;B&#65;')).toBe('A BA');
    });
});

describe('zol command registration', () => {
    it('registers search / param / price as PUBLIC read commands', () => {
        const reg = getRegistry();
        for (const name of ['search', 'param', 'price']) {
            const cmd = reg.get(`zol/${name}`);
            expect(cmd, `zol ${name} registered`).toBeTruthy();
            expect(cmd.strategy).toBe(Strategy.PUBLIC);
            expect(cmd.browser).toBe(false);
            expect(cmd.access).toBe('read');
        }
    });
});
