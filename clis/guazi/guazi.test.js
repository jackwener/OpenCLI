/**
 * Unit tests for the 瓜子二手车 (Guazi) adapter.
 *
 * Both commands parse mobile SSR HTML, so the pure parsers are exercised
 * against frozen real-data fixtures captured from m.guazi.com. No network.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

import {
    BROWSE_COLUMNS,
    CAR_COLUMNS,
    resolveCityCode,
    normalizeClueId,
    requireLimit,
} from './utils.js';
import { parseListings } from './browse.js';
import { parseCarDetail } from './car.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIST = readFileSync(join(__dirname, '__fixtures__/list.html'), 'utf8');
const DETAIL = readFileSync(join(__dirname, '__fixtures__/detail.html'), 'utf8');

describe('guazi adapter — registration', () => {
    it('registers browse + car as PUBLIC (no browser)', () => {
        for (const n of ['browse', 'car']) {
            const cmd = getRegistry().get(`guazi/${n}`);
            expect(cmd, n).toBeTruthy();
            expect(cmd.strategy, n).toBe(Strategy.PUBLIC);
            expect(cmd.browser, n).toBe(false);
            expect(cmd.access, n).toBe('read');
        }
        expect(getRegistry().get('guazi/browse').columns).toEqual(BROWSE_COLUMNS);
        expect(getRegistry().get('guazi/car').columns).toEqual(CAR_COLUMNS);
    });
});

describe('guazi adapter — utils', () => {
    it('resolveCityCode maps names, codes, and defaults to bj', () => {
        expect(resolveCityCode('北京')).toBe('bj');
        expect(resolveCityCode('shanghai')).toBe('sh');
        expect(resolveCityCode('gz')).toBe('gz');
        expect(resolveCityCode('')).toBe('bj');
        expect(resolveCityCode(undefined)).toBe('bj');
        expect(() => resolveCityCode('火星')).toThrow();
    });
    it('normalizeClueId accepts numbers and URLs', () => {
        expect(normalizeClueId('162563585115789')).toBe('162563585115789');
        expect(normalizeClueId('https://m.guazi.com/car-detail/c162563585115789.html')).toBe('162563585115789');
        expect(() => normalizeClueId('abc')).toThrow();
    });
    it('requireLimit enforces [1,max]', () => {
        expect(requireLimit(undefined, 20, 40)).toBe(20);
        expect(() => requireLimit(41, 20, 40)).toThrow();
    });
});

describe('guazi adapter — parsers against frozen fixtures', () => {
    it('parseListings extracts listings with price/mileage/year', () => {
        const rows = parseListings(LIST, 40);
        expect(rows.length).toBe(3);
        for (const r of rows) {
            expect(Object.keys(r).sort()).toEqual([...BROWSE_COLUMNS].sort());
            expect(r.clue_id).toMatch(/^\d+$/);
            expect(r.title).toBeTruthy();
            expect(r.url).toContain('/car-detail/c');
        }
        const first = rows[0];
        expect(first.price).toMatch(/万$/);
        expect(first.mileage).toMatch(/公里$/);
        expect(first.year).toMatch(/^\d{4}$/);
    });

    it('parseListings respects the limit and dedupes', () => {
        expect(parseListings(LIST, 2).length).toBe(2);
        expect(parseListings('<html>nothing</html>', 40)).toEqual([]);
    });

    it('browse treats a successful page with no listing anchors as parser drift', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            text: async () => '<html><title>瓜子二手车</title><main>new layout</main></html>',
        });
        try {
            await expect(getRegistry().get('guazi/browse').func({ city: 'bj', limit: 20 }))
                .rejects.toBeInstanceOf(CommandExecutionError);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('parseListings rejects malformed listing cards instead of silently dropping them', () => {
        expect(() => parseListings('<a href="/car-detail/c123.html"><span>6.8 万 首付 1 万</span></a>', 40))
            .toThrow(/stable text value/);
    });

    it('parseCarDetail builds a field/value sheet with price + specs', () => {
        const rows = parseCarDetail(DETAIL, '162563585115789');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(rows.every((r) => Object.keys(r).sort().join() === 'field,value')).toBe(true);
        expect(map.title).toBeTruthy();
        expect(map.title).not.toContain('二手');
        expect(map.title).not.toContain('报价');
        expect(map.price).toMatch(/万$/);
        expect(map.reg_date).toMatch(/^\d{4}-\d{2}$/);
        expect(map.mileage).toMatch(/公里$/);
        expect(map.engine).toBeTruthy();
        expect(map.gearbox).toBeTruthy();
        expect(map.condition).toContain('基础车况');
        expect(map.url).toContain('/car-detail/c162563585115789.html');
    });

    it('parseCarDetail tolerates an empty page', () => {
        const rows = parseCarDetail('<html></html>', '1');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(map.title).toBe('');
        expect(map.price).toBe('');
    });
});
