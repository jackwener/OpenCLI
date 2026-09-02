import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot-books.js';

describe('gutenberg hot-books', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('extracts titles and IDs from the requested top-book section', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => `
            <h2 id="books-last30">Top 100 EBooks last 30 days</h2><ol>
              <li><a href="/ebooks/2701">Moby Dick; Or, The Whale by Herman Melville (7134)</a></li>
              <li><a href="/ebooks/1342">Pride and Prejudice by Jane Austen (7123)</a></li>
            </ol>` });
        const rows = await getRegistry().get('gutenberg/hot-books').func({ period: '30days', limit: 2 });

        expect(rows).toEqual([
            { id: '2701', title: 'Moby Dick; Or, The Whale', url: 'https://www.gutenberg.org/ebooks/2701' },
            { id: '1342', title: 'Pride and Prejudice', url: 'https://www.gutenberg.org/ebooks/1342' },
        ]);
    });

    it('rejects missing ranking sections and malformed ranking rows', async () => {
        const command = getRegistry().get('gutenberg/hot-books');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<main></main>' });
        await expect(command.func({ period: 'yesterday' })).rejects.toBeInstanceOf(CommandExecutionError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2 id="books-last1">Top books</h2><ol><li><a href="/ebooks/broken">Broken book</a></li></ol>' });
        await expect(command.func({ period: 'yesterday' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
