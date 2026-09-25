import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './category-search.js';

const HTML = `
<meta name="totalResults" content="2">
<ul class="results">
  <li class="navlink"><a class="link" href="/ebooks/bookshelf/646"><span class="cell content"><span class="title">Category: Mythology, Legends &amp; Folklore</span><span class="extra">3,948,846 downloads</span></span></a></li>
  <li class="navlink"><a class="link" href="/ebooks/bookshelf/119"><span class="cell content"><span class="title">Christianity</span><span class="extra">227,041 downloads</span></span></a></li>
</ul>`;

const TITLE_HTML = `
<meta name="totalResults" content="2">
<ul class="results">
  <li class="navlink"><a class="link" href="/ebooks/bookshelf/646"><span class="cell content"><span class="title">Category: Mythology, Legends &amp; Folklore</span></span></a></li>
  <li class="navlink"><a class="link" href="/ebooks/bookshelf/119"><span class="cell content"><span class="title">Christianity</span></span></a></li>
</ul>`;

describe('gutenberg category-search', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('maps category search rows and translates title sorting to alpha', async () => {
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => TITLE_HTML })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML });

        const rows = await getRegistry().get('gutenberg/category-search').func({ query: 'faith', sort: 'title' });

        expect(globalThis.fetch.mock.calls[0][0]).toContain('sort_order=alpha');
        expect(rows).toEqual([
            { name: 'Category: Mythology, Legends & Folklore', downloads: 3948846, url: 'https://www.gutenberg.org/ebooks/bookshelf/646' },
            { name: 'Christianity', downloads: 227041, url: 'https://www.gutenberg.org/ebooks/bookshelf/119' },
        ]);
        expect(globalThis.fetch.mock.calls[1][0]).toContain('sort_order=downloads');
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it('uses the downloads-sorted page directly when downloads are requested', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML });
        const rows = await getRegistry().get('gutenberg/category-search').func({ query: 'faith', sort: 'downloads' });

        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
        expect(rows[0].downloads).toBe(3948846);
    });

    it.each([
        ['quantity', 'quantity'],
        ['release_date', 'release_date'],
    ])('passes %s to Gutenberg and merges download counts', async (sort, sortOrder) => {
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML });

        const rows = await getRegistry().get('gutenberg/category-search').func({ query: 'faith', sort });

        expect(globalThis.fetch.mock.calls[0][0]).toContain(`sort_order=${sortOrder}`);
        expect(globalThis.fetch.mock.calls[1][0]).toContain('sort_order=downloads');
        expect(rows[0].downloads).toBe(3948846);
    });

    it('rejects an empty query before fetching', async () => {
        await expect(getRegistry().get('gutenberg/category-search').func({ query: ' ' })).rejects.toBeInstanceOf(ArgumentError);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('distinguishes explicit empty results from selector drift', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<meta name="totalResults" content="0"><ul class="results"><li><span class="title">No records found.</span></li></ul>' });
        await expect(getRegistry().get('gutenberg/category-search').func({ query: 'missing' })).rejects.toBeInstanceOf(EmptyResultError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<ul class="results"></ul>' });
        await expect(getRegistry().get('gutenberg/category-search').func({ query: 'missing' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
