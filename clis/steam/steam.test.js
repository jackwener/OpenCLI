import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError } from '@jackwener/opencli/errors';
import { decodeHtmlEntities, requireCountryCode } from './utils.js';
import './search.js';
import './app.js';

afterEach(() => {
    vi.unstubAllGlobals();
});

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

describe('steam command argument contracts', () => {
    it('rejects invalid search currency before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const search = getRegistry().get('steam/search');
        await expect(search.func({ query: 'portal', limit: 5, currency: '$$$' })).rejects.toThrow(ArgumentError);
        await expect(search.func({ query: 'portal', limit: 5, currency: '' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid app currency before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        const app = getRegistry().get('steam/app');
        await expect(app.func({ id: '620', currency: 'usd' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
