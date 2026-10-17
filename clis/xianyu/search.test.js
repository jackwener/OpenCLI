import { describe, expect, it } from 'vitest';
import { ArgumentError } from '@jackwener/opencli/errors';

import { __test__ } from './search.js';
describe('xianyu search helpers', () => {
    it('normalizes limit into supported range', () => {
        expect(__test__.normalizeLimit(undefined)).toBe(20);
        expect(__test__.normalizeLimit(0)).toBe(1);
        expect(__test__.normalizeLimit(3.8)).toBe(3);
        expect(__test__.normalizeLimit(999)).toBe(__test__.MAX_LIMIT);
    });
    it('builds search URLs with encoded queries', () => {
        expect(__test__.buildSearchUrl('小鹏G9')).toBe('https://www.goofish.com/search?q=%E5%B0%8F%E9%B9%8FG9');
    });
});
describe('xianyu search price filter', () => {
    it('parses price arguments, returning null when omitted', () => {
        expect(__test__.parsePriceArg(undefined, 'min-price')).toBeNull();
        expect(__test__.parsePriceArg('', 'min-price')).toBeNull();
        expect(__test__.parsePriceArg('100000', 'min-price')).toBe(100000);
        expect(__test__.parsePriceArg(200000.5, 'max-price')).toBe(200000.5);
    });
    it('rejects negative or non-numeric price arguments', () => {
        expect(() => __test__.parsePriceArg('-1', 'min-price')).toThrow(ArgumentError);
        expect(() => __test__.parsePriceArg('abc', 'max-price')).toThrow(ArgumentError);
    });
    it('encodes priceRange the way goofish expects, filling open-ended bounds', () => {
        expect(__test__.buildSearchFilter(null, null)).toBe('');
        expect(__test__.buildSearchFilter(100000, 200000)).toBe('priceRange:100000,200000;');
        expect(__test__.buildSearchFilter(100000, null)).toBe('priceRange:100000,99999999;');
        expect(__test__.buildSearchFilter(null, 200000)).toBe('priceRange:0,200000;');
    });
});
describe('xianyu search region filter', () => {
    it('returns {} when no region is requested', () => {
        expect(__test__.buildExtraFilterValue('', '')).toBe('{}');
    });
    it('encodes a city alone (empty province)', () => {
        expect(JSON.parse(__test__.buildExtraFilterValue('', '深圳'))).toEqual({
            divisionList: [{ province: '', city: '深圳' }],
            excludeMultiPlacesSellers: '0',
            extraDivision: '',
        });
    });
    it('encodes a province alone, and a province+city pair', () => {
        expect(JSON.parse(__test__.buildExtraFilterValue('广东', '')).divisionList).toEqual([{ province: '广东', city: '' }]);
        expect(JSON.parse(__test__.buildExtraFilterValue('广东', '湛江')).divisionList).toEqual([{ province: '广东', city: '湛江' }]);
    });
});
