import { describe, expect, it } from 'vitest';

import { ArgumentError } from '@jackwener/opencli/errors';
import { __test__ } from './search.js';

describe('boss search', () => {
    it('keeps legacy 在校/应届 experience input compatible', () => {
        expect(__test__.resolveMap('在校/应届', __test__.EXP_MAP)).toBe('108');
        expect(__test__.resolveMap('应届', __test__.EXP_MAP)).toBe('102');
    });

    it('fails fast on invalid jobType values', async () => {
        expect(() => __test__.resolveJobType('外包')).toThrow(ArgumentError);
    });

    it('fails fast on unknown city names instead of silently searching Beijing', () => {
        expect(() => __test__.resolveCity('不存在的城市')).toThrow(ArgumentError);
    });

    it('accepts supported jobType labels and raw codes', () => {
        expect(__test__.resolveJobType('全职')).toBe('1901');
        expect(__test__.resolveJobType('实习')).toBe('1902');
        expect(__test__.resolveJobType('兼职')).toBe('1903');
        expect(__test__.resolveJobType('1902')).toBe('1902');
    });

});
