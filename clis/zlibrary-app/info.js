/**
 * Z-Library Desktop info command.
 *
 * Reads download-format links for a book — either the currently viewed
 * page (no args) or a book specified by --book-id (ID or URL).
 *
 * With --detail, also extracts page-level attributes (pages, ISBN, series,
 * volume, categories, description) from the book detail page.
 *
 * publisher and ISBN from the card are always included.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { requirePresentRow } from '../_shared/search-adapter.js';
import { extractBookTitle, extractFormats, extractBookDetailAttributes } from '../zlibrary/dom.js';
import { resolveBookSelector, navigateToBookSelector } from './_shared/infra/book-selector.js';
import { getCurrentHttpOrigin, assertSameOriginNotLoginWall } from './_shared/infra/url-boundary.js';

const EMPTY_DETAIL_FIELDS = {
  publisher: '', isbn: '', pages: '', isbn10: '', isbn13: '',
  series: '', volume: '', categories: '', description: ''
}

cli({
    site: 'zlibrary-app',
    name: 'info',
    access: 'read',
    description: 'Show available download formats for a Z-Library book',
    domain: 'localhost',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'book-id',
            required: false,
            help: 'Book ID or URL (default: current page). E.g. 5433175, /book/demo, https://z-lib.org/book/12345',
        },
        {
            name: 'detail',
            type: 'boolean',
            help: 'Fetch extra book attributes from the detail page (pages, ISBN, series, description, etc.)',
        },
    ],
    columns: ['title', 'pdf', 'epub', 'azw3', 'mobi', 'publisher', 'isbn', 'pages', 'isbn10', 'isbn13', 'series', 'volume', 'categories', 'description'],
    func: async (page, kwargs) => {
        const rawBookId = kwargs['book-id'];
        const hasDetail = Boolean(kwargs.detail);

        // Capture the starting origin for post-navigation trust boundary checks
        const startOrigin = await getCurrentHttpOrigin(page);

        // If --book-id is provided, navigate to the specified book page
        if (rawBookId != null && String(rawBookId).trim() !== '') {
            const selector = resolveBookSelector(rawBookId, '--book-id');
            await navigateToBookSelector(page, selector);
            // Post-navigation validation: ensure we're still same-origin and not on a login page.
            // navigateToBookSelector already validates pre-navigation origin for absolute URLs;
            // this catches same-origin redirects to /login or cross-origin pages.
            await assertSameOriginNotLoginWall(page, startOrigin, 'zlibrary-app info');
        }

        // Extract book details from the current page
        const title = await extractBookTitle(page);
        const formats = await extractFormats(page);

        requirePresentRow(
            title,
            'zlibrary-app info',
            'No book details found. Use --book-id to specify a book, or select one in the Z-Library Desktop app.',
        );

        // Always fetch publisher and ISBN from the card (zero-cost attributes)
        const cardAttrs = await page.evaluate(`
            (() => {
                var c = document.querySelector('z-bookcard');
                return JSON.stringify({
                    publisher: c ? (c.getAttribute('publisher') || '') : '',
                    isbn: c ? (c.getAttribute('isbn') || '') : ''
                });
            })()
        `);
        const parsed = (function() { try { return JSON.parse(cardAttrs || '{}'); } catch { return {}; } })();

        const row = {
            title,
            pdf: formats.pdf || '',
            epub: formats.epub || '',
            azw3: formats.azw3 || '',
            mobi: formats.mobi || '',
            ...EMPTY_DETAIL_FIELDS,
            publisher: String(parsed.publisher || ''),
            isbn: String(parsed.isbn || ''),
        };

        if (hasDetail) {
            const detail = await extractBookDetailAttributes(page);
            row.pages = detail.pages || '';
            row.isbn10 = detail.isbn10 || '';
            row.isbn13 = detail.isbn13 || '';
            row.series = detail.series || '';
            row.volume = detail.volume || '';
            row.categories = detail.categories || '';
            row.description = detail.description || '';
            // Override card-attrib publisher/isbn with detail page values
            // (detail extractor may have more reliable attribute values)
            if (detail.publisher) row.publisher = detail.publisher;
            if (detail.isbn) row.isbn = detail.isbn;
        }

        return [row];
    },
});
