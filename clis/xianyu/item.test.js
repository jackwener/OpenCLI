import { describe, expect, it } from 'vitest';

import { __test__ } from './item.js';
describe('xianyu item helpers', () => {
    it('normalizes numeric item ids', () => {
        expect(__test__.normalizeNumericId('1040754408976', 'item_id', '1040754408976')).toBe('1040754408976');
        expect(__test__.normalizeNumericId(1040754408976, 'item_id', '1040754408976')).toBe('1040754408976');
    });
    it('builds item urls', () => {
        expect(__test__.buildItemUrl('1040754408976')).toBe('https://www.goofish.com/item?id=1040754408976');
    });
    it('rejects invalid item ids', () => {
        expect(() => __test__.normalizeNumericId('abc', 'item_id', '1040754408976')).toThrow();
    });
});
