import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

const HTML = `<li class="booklink"><a href="/ebooks/1342"><span class="title">Pride and Prejudice</span><span class="subtitle">Jane Austen</span><span class="extra">198,164 downloads</span></a></li>
<li class="booklink"><a href="/ebooks/42671"><span class="title">Pride and Prejudice</span><span class="subtitle">Jane Austen</span><span class="extra">66,006 downloads</span></a></li>`;

describe('gutenberg search', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('passes the optional title and sort to the public HTML search', async () => {
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace(/<span class="extra">[\s\S]*?<\/span>/g, '') })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML });
        const rows = await getRegistry().get('gutenberg/search').func({ title: 'pride and prejudice', sort: 'title', limit: 1 });

        expect(globalThis.fetch.mock.calls[0][0]).toContain('query=pride+and+prejudice');
        expect(globalThis.fetch.mock.calls[0][0]).toContain('sort_order=title');
        expect(rows).toEqual([{ id: '1342', title: 'Pride and Prejudice', author: 'Jane Austen', url: 'https://www.gutenberg.org/ebooks/1342', downloads: 198164 }]);
        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        expect(globalThis.fetch.mock.calls[1][0]).toContain('sort_order=downloads');
    });

    it('rejects an invalid limit instead of silently clamping it', async () => {
        await expect(getRegistry().get('gutenberg/search').func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('distinguishes explicit empty results from book-list selector drift', async () => {
        const command = getRegistry().get('gutenberg/search');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<meta name="totalResults" content="0"><ul class="results"><li class="navlink"><span class="title">No records found.</span></li></ul>' });
        await expect(command.func({ title: 'missing' })).rejects.toBeInstanceOf(EmptyResultError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<ul class="results"></ul>' });
        await expect(command.func({ title: 'missing' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects a malformed book row instead of silently dropping it', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<li class="booklink"><a href="/ebooks/not-an-id"><span class="title">Broken book</span></a></li>' });
        await expect(getRegistry().get('gutenberg/search').func({ title: 'broken' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails when downloads sorting does not expose download counts', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace(/<span class="extra">[\s\S]*?<\/span>/g, '') });
        await expect(getRegistry().get('gutenberg/search').func({ title: 'missing counts' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails when a non-download sort cannot be joined to download counts', async () => {
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace(/<span class="extra">[\s\S]*?<\/span>/g, '') })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace('href="/ebooks/1342"', 'href="/ebooks/9999"') });

        await expect(getRegistry().get('gutenberg/search').func({ title: 'broken', sort: 'title', limit: 1 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
