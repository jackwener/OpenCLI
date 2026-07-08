// openalex work — fetch a single Work's record from OpenAlex.
//
// Hits `https://api.openalex.org/works/<id-or-doi>`. Accepts an OpenAlex
// Work id (`W2741809807`), a raw DOI (`10.7717/peerj.4375`), or a full
// `doi.org` / `openalex.org` URL. Returns one row plus the (decoded)
// abstract — OpenAlex stores abstracts as `abstract_inverted_index` so we
// reconstruct it for downstream readers.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    OPENALEX_BASE,
    appendMailto,
    bareDoi,
    bareId,
    openalexFetch,
    reconstructAbstract,
    requireWorkRef,
} from './utils.js';

const SELECT_FIELDS = [
    'id', 'doi', 'title', 'publication_year', 'publication_date',
    'cited_by_count', 'authorships', 'primary_location', 'open_access', 'type',
    'referenced_works', 'related_works', 'language', 'abstract_inverted_index',
].join(',');

cli({
    site: 'openalex',
    name: 'work',
    access: 'read',
    description: 'Fetch a single OpenAlex Work (paper / preprint / book) — metadata + abstract',
    domain: 'api.openalex.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'OpenAlex Work id ("W2741809807"), DOI ("10.7717/peerj.4375"), or full URL' },
    ],
    columns: ['id', 'title', 'type', 'year', 'date', 'language', 'authors', 'venue', 'citations', 'openAccess', 'openAccessUrl', 'referencedCount', 'doi', 'abstract', 'url'],
    func: async (args) => {
        const ref = requireWorkRef(args.id);
        const url = appendMailto(`${OPENALEX_BASE}/works/${encodeURIComponent(ref)}?select=${SELECT_FIELDS}`);
        const w = await openalexFetch(url, 'openalex work');
        const authors = Array.isArray(w.authorships)
            ? w.authorships.map((a) => String(a?.author?.display_name ?? '').trim()).filter(Boolean).join(', ')
            : '';
        const venue = String(w.primary_location?.source?.display_name ?? '').trim();
        const id = bareId(w.id);
        const oaUrl = String(w.open_access?.oa_url ?? '').trim();
        return [{
            id,
            title: String(w.title ?? '').trim(),
            type: String(w.type ?? '').trim(),
            year: w.publication_year != null ? Number(w.publication_year) : null,
            date: String(w.publication_date ?? '').trim(),
            language: String(w.language ?? '').trim(),
            authors,
            venue,
            citations: w.cited_by_count != null ? Number(w.cited_by_count) : null,
            openAccess: Boolean(w.open_access?.is_oa),
            openAccessUrl: oaUrl,
            referencedCount: Array.isArray(w.referenced_works) ? w.referenced_works.length : null,
            doi: bareDoi(w.doi),
            abstract: reconstructAbstract(w.abstract_inverted_index),
            url: id ? `https://openalex.org/${id}` : '',
        }];
    },
});
