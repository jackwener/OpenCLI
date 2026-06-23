/**
 * Unit tests for the 汽车之家 (Autohome) adapter.
 *
 * `brand` parses the catalog HTML; `score` parses koubei __NEXT_DATA__.
 * Both pure parsers run against frozen real-data fixtures (宝马 / series 6548).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    BRAND_COLUMNS,
    SCORE_COLUMNS,
    resolveBrandInitial,
    normalizeSeriesId,
    extractPageProps,
    requireLimit,
} from './utils.js';
import { parseBrandSeries } from './brand.js';
import { parseScore } from './score.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG = readFileSync(join(__dirname, '__fixtures__/catalog.html'), 'utf8');
const KOUBEI = JSON.parse(readFileSync(join(__dirname, '__fixtures__/koubei.json'), 'utf8'));

describe('autohome adapter — registration', () => {
    it('registers brand + score as PUBLIC (no browser)', () => {
        for (const n of ['brand', 'score']) {
            const cmd = getRegistry().get(`autohome/${n}`);
            expect(cmd, n).toBeTruthy();
            expect(cmd.strategy, n).toBe(Strategy.PUBLIC);
            expect(cmd.browser, n).toBe(false);
            expect(cmd.access, n).toBe('read');
        }
        expect(getRegistry().get('autohome/brand').columns).toEqual(BRAND_COLUMNS);
        expect(getRegistry().get('autohome/score').columns).toEqual(SCORE_COLUMNS);
    });
});

describe('autohome adapter — utils', () => {
    it('resolveBrandInitial maps brands and letters', () => {
        expect(resolveBrandInitial('宝马')).toBe('B');
        expect(resolveBrandInitial('比亚迪')).toBe('B');
        expect(resolveBrandInitial('理想')).toBe('L');
        expect(resolveBrandInitial('丰田')).toBe('F');
        expect(resolveBrandInitial('b')).toBe('B');
        expect(() => resolveBrandInitial('不存在的牌子')).toThrow();
        expect(() => resolveBrandInitial('')).toThrow();
    });
    it('normalizeSeriesId accepts numbers and URLs', () => {
        expect(normalizeSeriesId('6548')).toBe('6548');
        expect(normalizeSeriesId('https://k.autohome.com.cn/6548')).toBe('6548');
        expect(normalizeSeriesId('s6548')).toBe('6548');
        expect(() => normalizeSeriesId('宝马')).toThrow();
    });
    it('requireLimit rejects invalid limits instead of silently falling back', () => {
        expect(requireLimit(undefined, 60, 120)).toBe(60);
        expect(requireLimit('5', 60, 120)).toBe(5);
        expect(() => requireLimit('abc', 60, 120)).toThrow(/integer/);
        expect(() => requireLimit(121, 60, 120)).toThrow(/integer/);
    });
    it('extractPageProps returns null on missing blob', () => {
        expect(extractPageProps('<html>no</html>')).toBeNull();
    });
});

describe('autohome adapter — parsers against frozen fixtures', () => {
    it('parseBrandSeries lists a brand\'s series with id + guide price', () => {
        const rows = parseBrandSeries(CATALOG, '宝马', 60);
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
            expect(Object.keys(r).sort()).toEqual([...BRAND_COLUMNS].sort());
            expect(r.series_id).toMatch(/^\d+$/);
            expect(r.name).toContain('宝马');
            expect(r.url).toContain(`/${r.series_id}/`);
        }
        expect(rows.some((r) => /万/.test(r.price))).toBe(true);
    });

    it('parseBrandSeries returns [] for a brand not on the page', () => {
        expect(parseBrandSeries(CATALOG, '丰田', 60)).toEqual([]);
    });

    it('parseBrandSeries rejects catalog pages without brand blocks', () => {
        expect(() => parseBrandSeries('<html></html>', '宝马', 60)).toThrow(/unexpected HTML shape/);
    });

    it('parseBrandSeries rejects malformed series cards', () => {
        expect(() => parseBrandSeries('<dl><dt><div><a>宝马</a></div></dt><li id="s6548"></li></dl>', '宝马', 60))
            .toThrow(/stable text value/);
    });

    it('parseScore builds a rating sheet with overall + axes + pph', () => {
        const rows = parseScore(KOUBEI, '6548');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(rows.every((r) => Object.keys(r).sort().join() === 'field,value')).toBe(true);
        expect(map.name).toBe('宝马X5');
        expect(map.brand).toBe('宝马');
        expect(map.guide_price).toMatch(/万$/);
        expect(typeof map.overall).toBe('number');
        expect(map.overall).toBeGreaterThan(0);
        expect(map.overall).toBeLessThanOrEqual(5);
        // a known axis from the fixture
        expect(typeof map['空间']).toBe('number');
        expect(typeof map.pph_每百车故障).toBe('number');
        expect(map.url).toContain('/6548');
    });

    it('parseScore rejects malformed koubei payloads', () => {
        expect(() => parseScore({}, '6548')).toThrow(/unexpected payload shape/);
    });
});
