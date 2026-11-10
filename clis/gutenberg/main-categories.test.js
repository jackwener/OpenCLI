import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './main-categories.js';

describe('gutenberg main-categories', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('returns every category with its parent category', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => `
            <div class="bookshelves">
              <div class="book-list"><h2>Literature</h2><ul>
                <li><a href="/ebooks/bookshelf/645">Novels</a></li>
                <li><a href="/ebooks/bookshelf/637">Poetry &amp; Drama</a></li>
              </ul></div>
              <div class="book-list"><h2>Science &amp; Technology</h2><ul>
                <li><a href="/ebooks/bookshelf/672">Mathematics</a></li>
              </ul></div>
            </div>` });

        const rows = await getRegistry().get('gutenberg/main-categories').func();

        expect(rows).toEqual([
            { id: '645', name: 'Novels', parentName: 'Literature', url: 'https://www.gutenberg.org/ebooks/bookshelf/645' },
            { id: '637', name: 'Poetry & Drama', parentName: 'Literature', url: 'https://www.gutenberg.org/ebooks/bookshelf/637' },
            { id: '672', name: 'Mathematics', parentName: 'Science & Technology', url: 'https://www.gutenberg.org/ebooks/bookshelf/672' },
        ]);
    });

    it('rejects missing category groups and malformed category rows', async () => {
        const command = getRegistry().get('gutenberg/main-categories');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<div class="bookshelves"></div>' });
        await expect(command.func()).rejects.toBeInstanceOf(CommandExecutionError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<div class="book-list"><h2>Literature</h2><ul><li><a href="/ebooks/bookshelf/broken">Broken</a></li></ul></div>' });
        await expect(command.func()).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
