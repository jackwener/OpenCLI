import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './ebooks.js';

const HTML = `
<div class="summary-text-container">A short summary.</div>
<a class="read-online-button" href="/cache/epub/30849/pg30849-images.html">Read online now</a>
<a class="featured-format-link" href="/ebooks/30849.epub3.images" title="Download EPUB3"><span class="featured-format-name">EPUB3</span></a>
<span class="featured-format-size">448 kB</span>
<a class="other-format-link" href="/ebooks/30849.txt.utf-8" type="text/plain; charset=utf-8" title="Download (Plain Text (accessible))">Plain Text</a>
<span class="other-format-size">744 kB</span>
<table id="about_book_table">
<tr><th>Author</th><td> Austen, Jane </td></tr>
<tr><th>Title</th><td>Pride and Prejudice</td></tr>
<tr><th>Language</th><td>English</td></tr>
<tr><th>Subject</th><td property="dcterms:subject">Love stories</td></tr>
<tr><th>Release Date</th><td>Jan 28, 2006</td></tr>
<tr><th>Copyright</th><td>Public domain</td></tr>
<tr><th>Downloads</th><td>12,345 downloads in the last 30 days.</td></tr>
<tr><th>eBook-No.</th><td>1342</td></tr>
</table>`;

describe('gutenberg ebooks', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => vi.unstubAllGlobals());

    it('registers and maps book metadata plus format URLs', async () => {
        const command = getRegistry().get('gutenberg/ebooks');
        expect(command?.columns).toContain('formats');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML });

        const rows = await command.func({ id: '1342' });

        expect(rows[0]).toMatchObject({ id: '1342', title: 'Pride and Prejudice', author: 'Austen, Jane', downloads: 12345 });
        expect(rows[0].readOnlineUrl).toBe('https://www.gutenberg.org/cache/epub/30849/pg30849-images.html');
        expect(rows[0].formats).toHaveLength(2);
        expect(rows[0].formats[0].url).toBe('https://www.gutenberg.org/ebooks/30849.epub3.images');
        expect(rows[0].formats[1].mediaType).toBe('text/plain; charset=utf-8');
    });

    it('rejects malformed IDs before fetching', async () => {
        const command = getRegistry().get('gutenberg/ebooks');
        await expect(command.func({ id: 'abc' })).rejects.toBeInstanceOf(ArgumentError);
        expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('reports missing download-format selectors as page-shape drift', async () => {
        const command = getRegistry().get('gutenberg/ebooks');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace(/<a class="(?:featured|other)-format-link"[\s\S]*?<\/a>/g, '') });
        await expect(command.func({ id: '1342' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects a malformed download-format row instead of dropping it', async () => {
        const command = getRegistry().get('gutenberg/ebooks');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace('href="/ebooks/30849.epub3.images"', '') });
        await expect(command.func({ id: '1342' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects a detail page for a different ebook id', async () => {
        const command = getRegistry().get('gutenberg/ebooks');
        globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, text: async () => HTML.replace('<td>1342</td>', '<td>9999</td>') });
        await expect(command.func({ id: '1342' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
