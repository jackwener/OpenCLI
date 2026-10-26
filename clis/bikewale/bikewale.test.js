/**
 * Unit tests for the BikeWale adapter.
 *
 * Every command parses `window.__INITIAL_STATE__` from an SSR page, so the pure
 * parsers are exercised against frozen real-data fixtures captured from
 * bikewale.com (Royal Enfield brand page / homepage brand list / news listing /
 * Hunter 350 model page). No network, no browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import { extractInitialState, slugCore } from './utils.js';
import { parseBrandModels } from './brand.js';
import { parseBrands } from './brands.js';
import { parseNews } from './news.js';
import { parseVariants } from './model.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));
const BRAND = fx('brand.json');
const BRANDS = fx('brands.json');
const NEWS = fx('news.json');
const MODEL = fx('model.json');

describe('bikewale adapter — registration', () => {
    const names = ['brand', 'brands', 'news', 'model'];
    it('registers all commands as PUBLIC (no browser, read access)', () => {
        for (const n of names) {
            const cmd = getRegistry().get(`bikewale/${n}`);
            expect(cmd, n).toBeTruthy();
            expect(cmd.strategy, n).toBe(Strategy.PUBLIC);
            expect(cmd.browser, n).toBe(false);
            expect(cmd.access, n).toBe('read');
        }
    });

    it('row keys line up with declared columns (no silent column drift)', () => {
        const reg = getRegistry();
        expect(Object.keys(parseBrandModels(BRAND, 'royalenfield')[0]))
            .toEqual(reg.get('bikewale/brand').columns);
        expect(Object.keys(parseBrands(BRANDS)[0])).toEqual(reg.get('bikewale/brands').columns);
        expect(Object.keys(parseNews(NEWS)[0])).toEqual(reg.get('bikewale/news').columns);
        expect(Object.keys(parseVariants(MODEL, 'x')[0])).toEqual(reg.get('bikewale/model').columns);
    });
});

describe('bikewale utils — extractInitialState', () => {
    it('pulls the state out of an inline assignment, ignoring trailing JS', () => {
        const html =
            '<script>window.__INITIAL_STATE__ = {"a":1,"b":{"c":"}"}};\n' +
            'window.__IS_MOBILE__ = false;</script>';
        expect(extractInitialState(html)).toEqual({ a: 1, b: { c: '}' } });
    });
    it('returns null on missing / unparseable state', () => {
        expect(extractInitialState('<html>no state</html>')).toBeNull();
        expect(extractInitialState('window.__INITIAL_STATE__ = {not json}')).toBeNull();
        expect(extractInitialState('')).toBeNull();
    });
    it('slugCore reduces a name/slug to comparable letters+digits', () => {
        expect(slugCore('Royal Enfield')).toBe('royalenfield');
        expect(slugCore('brixton-motorcycles')).toBe('brixtonmotorcycles');
        expect(slugCore('Hunter 350')).toBe('hunter350');
        expect(slugCore('')).toBe('');
    });
});

describe('bikewale brand — parseBrandModels', () => {
    const rows = parseBrandModels(BRAND, 'royalenfield');

    it('returns one row per model', () => {
        expect(rows.length).toBe(BRAND.makePage.models.length);
        expect(rows.length).toBeGreaterThan(10);
    });
    it('maps an on-sale model with price / rating / specs', () => {
        const hunter = rows.find((r) => r.model === 'Hunter 350');
        expect(hunter).toMatchObject({
            brand: 'Royal Enfield',
            status: 'on-sale',
            priceInr: 137648,
            formattedPrice: '₹ 1,37,648',
            rating: 4.7,
            displacementCc: 349.34,
            fuel: 'Petrol',
        });
        expect(hunter.reviews).toBeGreaterThan(0);
        expect(hunter.url).toBe('https://www.bikewale.com/royalenfield-bikes/hunter-350/');
    });
    it('leaves price null for upcoming models', () => {
        const upcoming = rows.filter((r) => r.status === 'upcoming');
        expect(upcoming.length).toBeGreaterThan(0);
        for (const r of upcoming) expect(r.priceInr).toBeNull();
    });
    it('throws on an unexpected payload shape', () => {
        expect(() => parseBrandModels({}, 'x')).toThrow(/no makePage/);
    });
});

describe('bikewale brands — parseBrands', () => {
    const rows = parseBrands(BRANDS);

    it('returns every brand with a usable slug + url', () => {
        expect(rows.length).toBe(BRANDS.homePage.makeList.length);
        expect(rows.length).toBeGreaterThan(30);
        for (const r of rows) {
            expect(r.brand).toBeTruthy();
            expect(r.slug).toMatch(/^[a-z0-9-]+$/);
            expect(r.url).toBe(`https://www.bikewale.com/${r.slug}-bikes/`);
        }
    });
    it('is popularity-sorted (Royal Enfield first)', () => {
        expect(rows[0]).toMatchObject({ brand: 'Royal Enfield', slug: 'royalenfield' });
    });
    it('preserves a hyphenated slug (not derivable from the name)', () => {
        const brixton = rows.find((r) => r.brand === 'Brixton Motorcycles');
        expect(brixton?.slug).toBe('brixton-motorcycles');
    });
});

describe('bikewale news — parseNews', () => {
    const rows = parseNews(NEWS);

    it('returns articles with title / date / absolute url', () => {
        expect(rows.length).toBe(NEWS.editorialListing.contentData.length);
        for (const r of rows) {
            expect(r.title).toBeTruthy();
            expect(r.date).toBeTruthy();
            expect(r.url).toMatch(/^https:\/\/www\.bikewale\.com\/(news|expert-reviews)\/.+\/$/);
            expect(typeof r.views).toBe('number');
        }
    });
    it('throws on an unexpected payload shape', () => {
        expect(() => parseNews({})).toThrow(/no editorialListing/);
    });
});

describe('bikewale model — parseVariants', () => {
    const rows = parseVariants(MODEL, 'royalenfield hunter-350');

    it('returns one row per variant with price + differences', () => {
        expect(rows.length).toBe(MODEL.modelPage.versions.length);
        const std = rows.find((r) => r.variant === 'Standard');
        expect(std).toMatchObject({ priceInr: 137648, formattedPrice: '₹ 1,37,648', fuel: 'Petrol' });
        expect(std.differences).toMatch(/Braking System:/);
    });
    it('derives fuel from modelDetails, not the (zeroed) version field', () => {
        // versions[].fuelTypeId is 0 in the payload; Petrol must come from modelDetails.
        expect(MODEL.modelPage.versions[0].fuelTypeId).toBe(0);
        expect(rows.every((r) => r.fuel === 'Petrol')).toBe(true);
    });
    it('throws on an unexpected payload shape', () => {
        expect(() => parseVariants({}, 'x')).toThrow(/no modelPage/);
    });
});
