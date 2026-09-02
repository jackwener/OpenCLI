import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './author.js';

function book(id, extra = `${id} downloads`) {
    return `<li class="booklink"><a href="/ebooks/${id}"><span class="title">Book ${id}</span><span class="subtitle">Author Name</span><span class="extra">${extra}</span></a></li>`;
}

describe('gutenberg author', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('follows author pagination and returns all books', async () => {
        const firstPage = Array.from({ length: 25 }, (_, index) => book(index + 1)).join('');
        const firstTitlePage = Array.from({ length: 25 }, (_, index) => book(index + 1, 'Jan 1, 2020')).join('');
        const secondTitlePage = book(26, 'Jan 2, 2020');
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => firstTitlePage })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => secondTitlePage })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => firstPage })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => book(26) });

        const rows = await getRegistry().get('gutenberg/author').func({ id: '69', sort: 'title' });

        expect(rows).toHaveLength(26);
        expect(rows[0]).toMatchObject({ id: '1', title: 'Book 1', author: 'Author Name', downloads: 1 });
        expect(rows[25].id).toBe('26');
        expect(globalThis.fetch.mock.calls[0][0]).toContain('/ebooks/author/69?sort_order=title');
        expect(globalThis.fetch.mock.calls[1][0]).toContain('/ebooks/author/69?sort_order=title&start_index=26');
        expect(globalThis.fetch.mock.calls[2][0]).toContain('/ebooks/author/69?sort_order=downloads');
        expect(globalThis.fetch.mock.calls[3][0]).toContain('/ebooks/author/69?sort_order=downloads&start_index=26');
    });

    it('distinguishes an author with no books from book-list selector drift', async () => {
        const command = getRegistry().get('gutenberg/author');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<meta content="0" name="totalResults"><span class="title">No records found.</span>' });
        await expect(command.func({ id: '999999999', sort: 'downloads' })).rejects.toBeInstanceOf(EmptyResultError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<main><ul class="results"></ul></main>' });
        await expect(command.func({ id: '69', sort: 'downloads' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails when a non-download sort cannot be joined to download counts', async () => {
        globalThis.fetch
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => book(1, 'Jan 1, 2020') })
            .mockResolvedValueOnce({ ok: true, status: 200, text: async () => book(1, 'not available') });

        await expect(getRegistry().get('gutenberg/author').func({ id: '69', sort: 'title' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
