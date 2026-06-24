/**
 * Unit tests for the 懂车帝 (Dongchedi) adapter.
 *
 * Every command parses `__NEXT_DATA__` JSON from an SSR page, so the pure
 * parsers are exercised against frozen real-data fixtures captured from
 * dongchedi.com (series 5273 = 宝马X5). No network, no browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    SEARCH_COLUMNS,
    SERIES_COLUMNS,
    MODELS_COLUMNS,
    SPECS_COLUMNS,
    SCORE_COLUMNS,
    KOUBEI_COLUMNS,
    extractPageProps,
    isFallbackShell,
    parseScore,
    normalizeSeriesId,
    requireLimit,
    clean,
    snippet,
} from './utils.js';
import { parseSearchRows } from './search.js';
import { parseSeries } from './series.js';
import { parseModels } from './models.js';
import { parseSpecs } from './specs.js';
import { parseScoreBreakdown } from './score.js';
import { parseKoubei } from './koubei.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
const SEARCH = fx('search.json');
const DETAIL = fx('series-detail.json');
const SCORE = fx('series-score.json');

describe('dongchedi adapter — registration', () => {
    const names = ['search', 'series', 'models', 'specs', 'score', 'koubei'];
    it('registers all commands as PUBLIC (no browser)', () => {
        for (const n of names) {
            const cmd = getRegistry().get(`dongchedi/${n}`);
            expect(cmd, n).toBeTruthy();
            expect(cmd.strategy, n).toBe(Strategy.PUBLIC);
            expect(cmd.browser, n).toBe(false);
            expect(cmd.access, n).toBe('read');
        }
    });
    it('declares the expected columns', () => {
        expect(getRegistry().get('dongchedi/search').columns).toEqual(SEARCH_COLUMNS);
        expect(getRegistry().get('dongchedi/series').columns).toEqual(SERIES_COLUMNS);
        expect(getRegistry().get('dongchedi/models').columns).toEqual(MODELS_COLUMNS);
        expect(getRegistry().get('dongchedi/specs').columns).toEqual(SPECS_COLUMNS);
        expect(getRegistry().get('dongchedi/score').columns).toEqual(SCORE_COLUMNS);
        expect(getRegistry().get('dongchedi/koubei').columns).toEqual(KOUBEI_COLUMNS);
    });
});

describe('dongchedi adapter — utils', () => {
    it('extractPageProps pulls pageProps from a __NEXT_DATA__ blob', () => {
        const html = `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { hello: 'world' } } })}</script></body></html>`;
        expect(extractPageProps(html)).toEqual({ hello: 'world' });
    });
    it('extractPageProps returns null on missing/invalid blob', () => {
        expect(extractPageProps('<html>no data</html>')).toBeNull();
        expect(extractPageProps('<script id="__NEXT_DATA__">{not json}</script>')).toBeNull();
    });
    it('isFallbackShell flags the empty city-gateway shell', () => {
        expect(isFallbackShell({ __hasUrlCity: true, is_gray: false, clientIp: '1.2.3.4' })).toBe(true);
        expect(isFallbackShell({ seriesHomeHead: {} })).toBe(false);
        expect(isFallbackShell(null)).toBe(true);
    });
    it('parseScore rescales x100 ints to /5 floats', () => {
        expect(parseScore(422)).toBe(4.22);
        expect(parseScore(500)).toBe(5);
        expect(parseScore(0)).toBeNull();
        expect(parseScore(undefined)).toBeNull();
    });
    it('normalizeSeriesId accepts numbers and URLs, rejects junk', () => {
        expect(normalizeSeriesId('5273')).toBe('5273');
        expect(normalizeSeriesId('https://www.dongchedi.com/auto/series/5273')).toBe('5273');
        expect(() => normalizeSeriesId('宝马X5')).toThrow();
        expect(() => normalizeSeriesId('')).toThrow();
    });
    it('requireLimit enforces [1,max]', () => {
        expect(requireLimit(undefined, 10, 30)).toBe(10);
        expect(requireLimit(5, 10, 30)).toBe(5);
        expect(() => requireLimit(0, 10, 30)).toThrow();
        expect(() => requireLimit(31, 10, 30)).toThrow();
    });
    it('clean/snippet normalize whitespace and truncate', () => {
        expect(clean('  a\n b  ')).toBe('a b');
        expect(snippet('x'.repeat(200), 10)).toBe(`${'x'.repeat(10)}…`);
        expect(snippet('short', 10)).toBe('short');
    });
});

describe('dongchedi adapter — parsers against frozen fixtures', () => {
    it('parseSearchRows keeps only car series and respects limit', () => {
        const rows = parseSearchRows(SEARCH, 3);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(3);
        const r = rows[0];
        expect(Object.keys(r).sort()).toEqual([...SEARCH_COLUMNS].sort());
        expect(r.series_id).toBeTruthy();
        expect(r.name).toBeTruthy();
        expect(r.url).toContain('/auto/series/');
        // every row must be a real series (no zero ids leaked in)
        expect(rows.every((x) => x.series_id && x.series_id !== '0')).toBe(true);
    });

    it('parseSeries builds a complete field/value sheet', () => {
        const rows = parseSeries(DETAIL, '5273');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(rows.every((r) => Object.keys(r).sort().join() === 'field,value')).toBe(true);
        expect(map.name).toBe('宝马X5');
        expect(map.brand).toBe('宝马');
        expect(map.official_price).toMatch(/万/);
        expect(typeof map.score).toBe('number');
        expect(map.score).toBeGreaterThan(0);
        expect(map.score).toBeLessThanOrEqual(5);
        expect(map.url).toContain('/auto/series/5273');
    });

    it('parseModels returns on-sale trims with real car_ids', () => {
        const rows = parseModels(DETAIL.carModelsData, 'online');
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
            expect(Object.keys(r).sort()).toEqual([...MODELS_COLUMNS].sort());
            expect(r.car_id).toMatch(/^\d+$/);
            expect(r.name).toBeTruthy();
        }
    });

    it('parseSpecs surfaces dimensions and powertrain', () => {
        const rows = parseSpecs(DETAIL.overviewData, '5273');
        const map = Object.fromEntries(rows.map((r) => [r.field, r.value]));
        expect(rows.every((r) => Object.keys(r).sort().join() === 'field,value')).toBe(true);
        expect(map.dimensions).toMatch(/\d+ × \d+ × \d+ mm/);
        expect(map.wheelbase).toMatch(/mm/);
        expect(map.power).toBeTruthy();
    });

    it('parseScoreBreakdown maps the 8 axes with same-level averages', () => {
        const sameLevel = (DETAIL.reviewData.same_level_review || []).find((r) => String(r.series_id) === '0')
            || DETAIL.reviewData.average_series_review;
        const rows = parseScoreBreakdown(DETAIL.scoreSimpleInfo, sameLevel);
        expect(rows.length).toBe(8);
        const overall = rows.find((r) => r.dimension === '综合');
        expect(overall.score).toBeGreaterThan(0);
        expect(overall.same_level_avg).toBeGreaterThan(0);
        for (const r of rows) expect(Object.keys(r).sort()).toEqual([...SCORE_COLUMNS].sort());
    });

    it('parseKoubei returns owner reviews with body + url', () => {
        const rows = parseKoubei(SCORE.reviewListData, 3);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.length).toBeLessThanOrEqual(3);
        const r = rows[0];
        expect(Object.keys(r).sort()).toEqual([...KOUBEI_COLUMNS].sort());
        expect(r.user).toBeTruthy();
        expect(r.content).toBeTruthy();
        expect(typeof r.likes).toBe('number');
        expect(r.url).toContain('/ugc/article/');
    });

    it('parsers fail closed on malformed source payloads', () => {
        expect(() => parseSearchRows({}, 5)).toThrow(/unexpected payload shape/);
        expect(() => parseSearchRows(null, 5)).toThrow(/unexpected payload shape/);
        expect(() => parseModels({}, 'online')).toThrow(/unexpected payload shape/);
        expect(() => parseKoubei({}, 5)).toThrow(/unexpected payload shape/);
        expect(() => parseSpecs(null, '1')).toThrow(/unexpected payload shape/);
        expect(() => parseSeries({}, '1')).toThrow(/unexpected payload shape/);
    });

    it('row parsers reject malformed identities and required text', () => {
        expect(() => parseSearchRows({ data: [{ cell_type: 26, series_id: 0, display: { series_name: '坏行' } }] }, 5))
            .toThrow(/stable numeric id/);
        expect(() => parseSearchRows({ data: [{ cell_type: 26, series_id: 1, display: {} }] }, 5))
            .toThrow(/stable text value/);
        expect(() => parseModels({ tab_list: [{ tab_key: 'online_all', data: [{ info: { car_id: 1 } }] }] }, 'online'))
            .toThrow(/stable text value/);
        expect(() => parseKoubei({ review_list: [{ user_info: { name: 'u' }, content: 'body' }] }, 5))
            .toThrow(/stable numeric id/);
    });
});
