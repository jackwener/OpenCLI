import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './categories.js';

describe('gutenberg categories', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('filters reading-list categories by initial', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => `
            <h2> All Reading Lists </h2><div class="bookshelves">
              <div class="book-list"><h2>A</h2><ul><li><a href="/ebooks/bookshelf/82">Adventure</a></li><li><a href="/ebooks/bookshelf/5">Africa</a></li></ul></div>
              <div class="book-list"><h2>B</h2><ul><li><a href="/ebooks/bookshelf/13">Best Books</a></li></ul></div>
            </div>` });
        const rows = await getRegistry().get('gutenberg/categories').func({ initial: 'a' });

        expect(rows).toEqual([
            { id: '82', initial: 'A', name: 'Adventure', url: 'https://www.gutenberg.org/ebooks/bookshelf/82' },
            { id: '5', initial: 'A', name: 'Africa', url: 'https://www.gutenberg.org/ebooks/bookshelf/5' },
        ]);
    });

    it('rejects a non-letter initial', async () => {
        await expect(getRegistry().get('gutenberg/categories').func({ initial: 'AA' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('keeps an absent initial as empty but treats a missing category contract as drift', async () => {
        const command = getRegistry().get('gutenberg/categories');
        const validPage = '<h2>All Reading Lists</h2><div class="book-list"><h2>A</h2><ul><li><a href="/ebooks/bookshelf/82">Adventure</a></li></ul></div>';
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => validPage });
        await expect(command.func({ initial: 'Z' })).rejects.toBeInstanceOf(EmptyResultError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2>All Reading Lists</h2><div class="bookshelves"></div>' });
        await expect(command.func({ initial: 'A' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects a malformed category row instead of silently dropping it', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2>All Reading Lists</h2><div class="book-list"><h2>A</h2><ul><li><a href="/ebooks/bookshelf/">Broken</a></li></ul></div>' });
        await expect(getRegistry().get('gutenberg/categories').func({ initial: 'A' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
