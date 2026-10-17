import { describe, expect, it } from 'vitest';

import { ArgumentError } from '@jackwener/opencli/errors';
import { decodeHtmlEntities, requireCountryCode } from './utils.js';

describe('steam adapter helpers', () => {
    it('decodes Steam HTML entities from API strings', () => {
        expect(decodeHtmlEntities('&quot;Perpetual Testing Initiative&quot; &amp; Co-op')).toBe('"Perpetual Testing Initiative" & Co-op');
        expect(decodeHtmlEntities('Portal &#x32;')).toBe('Portal 2');
    });

    it('validates storefront country code without silent fallback', () => {
        expect(requireCountryCode(undefined)).toBe('us');
        expect(requireCountryCode(' CN ')).toBe('cn');
        expect(() => requireCountryCode('')).toThrow(ArgumentError);
        expect(() => requireCountryCode('usd')).toThrow(ArgumentError);
        expect(() => requireCountryCode('$$')).toThrow(ArgumentError);
    });
});
