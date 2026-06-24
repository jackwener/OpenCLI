/**
 * Unit tests for the 汽车之家二手车 / 车168 (che168) adapter.
 *
 * `spec` parses GBK cache-API JSON; `browse`/`car` parse rendered used-car DOM
 * (the pages are 瑞数-gated, so the live data is reached through the logged-in
 * browser). All parsers are pure and exercised here against frozen fixtures —
 * no network.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    BROWSE_COLUMNS,
    CAR_COLUMNS,
    SPEC_COLUMNS,
    normalizeInfoId,
    normalizeSpecId,
} from './utils.js';
import { parseParams } from './spec.js';
import { extractListings } from './browse.js';
import { extractCarDetail } from './car.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PARAM = JSON.parse(readFileSync(join(__dirname, '__fixtures__/param.json'), 'utf8'));
const LIST = readFileSync(join(__dirname, '__fixtures__/list.html'), 'utf8');
const DETAIL = readFileSync(join(__dirname, '__fixtures__/detail.html'), 'utf8');

describe('che168 adapter — registration', () => {
    it('registers spec as PUBLIC (no browser)', () => {
        const spec = getRegistry().get('che168/spec');
        expect(spec).toBeTruthy();
        expect(spec.strategy).toBe(Strategy.PUBLIC);
        expect(spec.browser).toBe(false);
        expect(spec.access).toBe('read');
        expect(spec.columns).toEqual(SPEC_COLUMNS);
    });

    it('registers browse + car as browser commands', () => {
        for (const n of ['browse', 'car']) {
            const cmd = getRegistry().get(`che168/${n}`);
            expect(cmd, n).toBeTruthy();
            expect(cmd.browser, n).toBe(true);
            expect(cmd.access, n).toBe('read');
        }
        expect(getRegistry().get('che168/browse').columns).toEqual(BROWSE_COLUMNS);
        expect(getRegistry().get('che168/car').columns).toEqual(CAR_COLUMNS);
    });
});

describe('che168 adapter — utils', () => {
    it('normalizeSpecId accepts numbers, spec URLs, and specid params', () => {
        expect(normalizeSpecId('39616')).toBe('39616');
        expect(normalizeSpecId('https://www.autohome.com.cn/spec/39616/')).toBe('39616');
        expect(normalizeSpecId('https://cacheapigo.che168.com/CarProduct/GetParam.ashx?specid=39616')).toBe('39616');
        expect(() => normalizeSpecId('abc')).toThrow();
        expect(() => normalizeSpecId('')).toThrow();
    });

    it('normalizeInfoId accepts numbers and detail URLs', () => {
        expect(normalizeInfoId('51234567')).toBe('51234567');
        expect(normalizeInfoId('https://www.che168.com/dealer/123/51234567.html')).toBe('51234567');
        expect(() => normalizeInfoId('abc')).toThrow();
    });
});

describe('che168 adapter — spec parser against frozen fixture', () => {
    it('parseParams flattens groups into group/field/value rows', () => {
        const rows = parseParams(PARAM);
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
            expect(Object.keys(r).sort()).toEqual([...SPEC_COLUMNS].sort());
            expect(r.field).toBeTruthy();
        }
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(map['车型名称']).toContain('宝马3系');
        expect(map['厂商指导价(元)']).toMatch(/万$/);
        // groups are preserved
        const groups = new Set(rows.map((r) => r.group));
        expect(groups.has('基本参数')).toBe(true);
        expect(groups.has('发动机')).toBe(true);
    });

    it('parseParams tolerates an empty / discontinued specid', () => {
        expect(parseParams({ returncode: 0, result: { specid: 1, paramtypeitems: [] } })).toEqual([]);
        expect(parseParams({})).toEqual([]);
    });
});

function withDom(html, url, fn) {
    const dom = new JSDOM(html, { url });
    const prevDoc = globalThis.document;
    const prevLoc = globalThis.location;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    try {
        return fn();
    } finally {
        globalThis.document = prevDoc;
        globalThis.location = prevLoc;
    }
}

describe('che168 adapter — used-car DOM extractors against frozen fixtures', () => {
    it('extractListings pulls listing rows with price/year/mileage', () => {
        const rows = withDom(LIST, 'https://www.che168.com/beijing/', () => extractListings(40));
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
            expect(Object.keys(r).sort()).toEqual([...BROWSE_COLUMNS].sort());
            expect(r.info_id).toMatch(/^\d+$/);
            expect(r.title).toBeTruthy();
            expect(r.url).toContain('.html');
        }
        expect(rows[0].price).toMatch(/万$/);
    });

    it('extractListings respects the limit', () => {
        const rows = withDom(LIST, 'https://www.che168.com/beijing/', () => extractListings(1));
        expect(rows.length).toBe(1);
    });

    it('extractCarDetail builds a field/value sheet with price + specs', () => {
        const rows = withDom(DETAIL, 'https://www.che168.com/dealer/0/0.html', () => extractCarDetail());
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(rows.every((r) => Object.keys(r).sort().join() === 'field,value')).toBe(true);
        expect(map.title).toBeTruthy();
        expect(map.price).toMatch(/万$/);
    });
});
