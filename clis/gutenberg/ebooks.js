import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildUrl, fetchText, parseBookDetails, requireId } from './utils.js';

cli({
    site: 'gutenberg',
    name: 'ebooks',
    access: 'read',
    description: 'Get Project Gutenberg ebook metadata and download URLs for all formats',
    domain: 'www.gutenberg.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [{ name: 'id', positional: true, required: true, help: 'Gutenberg ebook number, for example 30849' }],
    columns: ['id', 'title', 'author', 'summary', 'language', 'subjects', 'releaseDate', 'lastUpdate', 'copyright', 'downloads', 'readOnlineUrl', 'url', 'formats'],
    func: async (args) => {
        const id = requireId(args.id, 'ebook id');
        const book = parseBookDetails(await fetchText(buildUrl(`/ebooks/${id}`), `gutenberg ebook ${id}`), id);
        return [{ id: book.id, title: book.title, author: book.author, summary: book.summary, language: book.language, subjects: book.subjects, releaseDate: book.releaseDate, lastUpdate: book.lastUpdate, copyright: book.copyright, downloads: book.downloads, readOnlineUrl: book.readOnlineUrl, url: book.url, formats: book.formats }];
    },
});
