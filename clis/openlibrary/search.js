// openlibrary search — search the Open Library book index.
//
// Hits `https://openlibrary.org/search.json?q=…`. Returns the agent-useful
// projection: work key (round-trips into `openlibrary work`), title, author,
// first publish year, edition count, ebook access, ISBN list, language list,
// cover id, subject highlights.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { OL_BASE, olFetch, requireBoundedInt, requireString } from './utils.js';

const SEARCH_FIELDS = [
    'key',
    'title',
    'author_name',
    'first_publish_year',
    'edition_count',
    'ebook_access',
    'language',
    'isbn',
    'subject',
    'cover_i',
];

function pickWorkKey(doc) {
    const k = String(doc?.key ?? '').trim();
    if (!k) return '';
    const slash = k.lastIndexOf('/');
    return slash >= 0 ? k.slice(slash + 1) : k;
}

function pickFirst(arr, max = 3) {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const filtered = arr.slice(0, max).filter((v) => typeof v === 'string' && v.trim());
    return filtered.length ? filtered.join(', ') : null;
}

cli({
    site: 'openlibrary',
    name: 'search',
    access: 'read',
    description: 'Search Open Library books by keyword',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (title / author / subject)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max books (1-100)' },
    ],
    columns: ['rank', 'workKey', 'title', 'author', 'firstPublished', 'editions', 'ebook', 'language', 'isbn', 'subjects', 'coverId', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const params = new URLSearchParams({
            q: query,
            limit: String(limit),
            fields: SEARCH_FIELDS.join(','),
        });
        const url = `${OL_BASE}/search.json?${params}`;
        const body = await olFetch(url, 'openlibrary search');
        const list = Array.isArray(body?.docs) ? body.docs : [];
        if (!list.length) {
            throw new EmptyResultError('openlibrary search', `No Open Library books matched "${query}".`);
        }
        return list.slice(0, limit).map((doc, i) => {
            const workKey = pickWorkKey(doc);
            return {
                rank: i + 1,
                workKey,
                title: String(doc.title ?? '').trim(),
                author: pickFirst(doc.author_name, 5),
                firstPublished: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
                editions: typeof doc.edition_count === 'number' ? doc.edition_count : null,
                ebook: String(doc.ebook_access ?? '').trim() || null,
                language: pickFirst(doc.language, 5),
                isbn: pickFirst(doc.isbn, 3),
                subjects: pickFirst(doc.subject, 3),
                coverId: typeof doc.cover_i === 'number' ? doc.cover_i : null,
                url: workKey ? `${OL_BASE}/works/${workKey}` : '',
            };
        });
    },
});
