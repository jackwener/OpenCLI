// openlibrary work — fetch a single Open Library Work by OLID or ISBN.
//
// Endpoints:
//   GET /works/<OLID>.json    (when ref is "OL45804W" etc.)
//   GET /isbn/<isbn>.json → /works/<OLID>.json (when ref is an ISBN)
//
// Returns one row with title, the Work-level description, subjects (full
// list, comma-joined), first publish date, the linked author OLIDs, and
// a cover URL (derived from the first cover id on the work).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OL_BASE,
    classifyWorkRef,
    flattenDescription,
    olFetch,
    pickAuthorOlids,
    resolveWorkOlidFromIsbn,
} from './utils.js';

cli({
    site: 'openlibrary',
    name: 'work',
    access: 'read',
    description: 'Open Library Work detail by OLID or ISBN',
    domain: 'openlibrary.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'ref', positional: true, required: true, help: 'OLID (e.g. "OL45804W") or ISBN-10/-13' },
    ],
    columns: [
        'olid', 'title', 'firstPublishDate', 'subjects', 'subjectPlaces',
        'subjectTimes', 'authorOlids', 'description', 'coverUrl', 'url',
    ],
    func: async (args) => {
        const ref = classifyWorkRef(args.ref);
        const olid = ref.kind === 'olid' ? ref.value : await resolveWorkOlidFromIsbn(ref.value, 'openlibrary work');
        const url = `${OL_BASE}/works/${olid}.json`;
        const body = await olFetch(url, 'openlibrary work');
        if (!body || !body.key) {
            throw new EmptyResultError('openlibrary work', `Open Library returned no work for "${args.ref}".`);
        }
        const subjects = Array.isArray(body.subjects) ? body.subjects.join(', ') : '';
        const subjectPlaces = Array.isArray(body.subject_places) ? body.subject_places.join(', ') : '';
        const subjectTimes = Array.isArray(body.subject_times) ? body.subject_times.join(', ') : '';
        const authorOlids = pickAuthorOlids(body.authors).join(', ');
        const coverId = Array.isArray(body.covers) && body.covers.length > 0 ? body.covers[0] : null;
        return [{
            olid,
            title: String(body.title ?? '').trim(),
            firstPublishDate: body.first_publish_date ? String(body.first_publish_date).trim() : null,
            subjects,
            subjectPlaces,
            subjectTimes,
            authorOlids,
            description: flattenDescription(body.description),
            coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` : '',
            url: `https://openlibrary.org/works/${olid}`,
        }];
    },
});
