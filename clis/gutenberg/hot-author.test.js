import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot-author.js';

describe('gutenberg hot-author', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('selects the requested author period and limits rows', async () => {
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => `
            <h2 id="authors-last1">Top 100 Authors yesterday</h2><ol><li><a href="/browse/authors/d#a69">Doyle, Arthur Conan (42894)</a></li></ol>
            <h2 id="authors-last7">Top 100 Authors last 7 days</h2><ol><li><a href="/browse/authors/s#a65">Shakespeare, William (33506)</a></li><li><a href="/browse/authors/c#a451">Christie, Agatha (33463)</a></li></ol>` });
        const rows = await getRegistry().get('gutenberg/hot-author').func({ period: '7days', limit: 1 });

        expect(rows).toEqual([{ id: '65', name: 'Shakespeare, William', url: 'https://www.gutenberg.org/browse/authors/s#a65' }]);
    });

    it('rejects missing ranking sections and malformed ranking rows', async () => {
        const command = getRegistry().get('gutenberg/hot-author');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<main></main>' });
        await expect(command.func({ period: 'yesterday' })).rejects.toBeInstanceOf(CommandExecutionError);

        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => '<h2 id="authors-last1">Top authors</h2><ol><li><a href="/browse/authors/d">Broken author</a></li></ol>' });
        await expect(command.func({ period: 'yesterday' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
