import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './collections.js';

describe('gutenberg collections', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('reads only the top Collections block in page order', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => `
            <h2> Collections </h2><div class="bookshelves"><ul>
              <li><a href="/ebooks/bookshelves/search/?query=animal">&quot;Animals&quot; Reading Lists</a></li>
              <li><a href="/ebooks/bookshelf/emmys">&quot;Emmy's Picks&quot;</a></li>
            </ul></div>
            <h2> All Reading Lists </h2><div class="book-list"><h2>A</h2></div>` });
        const command = getRegistry().get('gutenberg/collections');
        expect(command.args).toEqual([]);
        const rows = await command.func();

        expect(rows).toEqual([
            { name: '"Animals" Reading Lists', url: 'https://www.gutenberg.org/ebooks/bookshelves/search/?query=animal' },
            { name: '"Emmy\'s Picks"', url: 'https://www.gutenberg.org/ebooks/bookshelf/emmys' },
        ]);
    });

    it('rejects missing section boundaries and malformed collection rows', async () => {
        const command = getRegistry().get('gutenberg/collections');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2>Collections</h2><div class="bookshelves"></div>' });
        await expect(command.func()).rejects.toBeInstanceOf(CommandExecutionError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2>Collections</h2><li><a href="/ebooks/broken">Broken</a></li><h2>All Reading Lists</h2>' });
        await expect(command.func()).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
