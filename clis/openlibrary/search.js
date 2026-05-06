// openlibrary search — search Open Library by free text.
//
// Endpoint: GET /search.json?q=…&limit=…&fields=…
//
// IMPORTANT: We pass an explicit `fields=` projection. Without it, Open
// Library drops `isbn`, `subject`, and other "expensive" fields silently
// from the search response, which would leave the corresponding output
// columns silently empty (a silent-empty-column trap). Opting in keeps
// every column populated when the underlying record has the data.
//
// Returns one row per matching work with the OLID (round-trips into
// `openlibrary work <olid>`), title, primary author, first publish year,
// edition + ISBN counts, subjects (first 3 joined), and the cover URL
// derived from the cover edition id when available.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OL_BASE,
    olFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'search',
    access: 'read',
    description: 'Search Open Library books by title / author / keyword',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text (title, author, or keyword)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-100, default 20)' },
    ],
    columns: [
        'rank', 'olid', 'title', 'firstAuthor', 'firstPublishYear',
        'editionCount', 'isbnCount', 'subjects', 'language',
        'coverUrl', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const fields = 'key,title,author_name,first_publish_year,edition_count,isbn,subject,language,cover_i';
        const url = `${OL_BASE}/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`;
        const body = await olFetch(url, 'openlibrary search');
        const list = Array.isArray(body?.docs) ? body.docs : [];
        if (!list.length) {
            throw new EmptyResultError('openlibrary search', `Open Library returned no books matching "${query}".`);
        }
        return list.slice(0, limit).map((d, i) => {
            const olKey = String(d?.key ?? '').trim();
            const olidMatch = olKey.match(/(OL\d+W)$/);
            const olid = olidMatch ? olidMatch[1] : '';
            const subjects = Array.isArray(d.subject) ? d.subject.slice(0, 3).join(', ') : '';
            const lang = Array.isArray(d.language) && d.language.length ? String(d.language[0]) : '';
            const coverId = d.cover_i;
            return {
                rank: i + 1,
                olid,
                title: String(d.title ?? '').trim(),
                firstAuthor: Array.isArray(d.author_name) && d.author_name.length ? String(d.author_name[0]) : '',
                firstPublishYear: d.first_publish_year != null ? Number(d.first_publish_year) : null,
                editionCount: d.edition_count != null ? Number(d.edition_count) : null,
                isbnCount: Array.isArray(d.isbn) ? d.isbn.length : 0,
                subjects,
                language: lang,
                coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
                url: olid ? `https://openlibrary.org/works/${olid}` : '',
            };
        });
    },
});
