// semanticscholar paper: single-paper detail with citation graph + AI tldr.
//
// Hits `/paper/{ref}?fields=...`. Surfaces the two fields that are unique to
// Semantic Scholar versus the existing arxiv/openalex/dblp/pubmed adapters:
// `influentialCitationCount` (their gated "important" count) and `tldr.text`
// (LLM-generated one-line summary).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import {
    S2_GRAPH_BASE,
    normalizePaperRow,
    optionalNumber,
    requirePaperRef,
    s2Fetch,
    tldrText,
} from './utils.js';

const FIELDS = [
    'paperId', 'title', 'year', 'authors', 'citationCount',
    'influentialCitationCount', 'referenceCount', 'tldr', 'externalIds', 'url',
].join(',');

cli({
    site: 'semanticscholar',
    name: 'paper',
    access: 'read',
    description: 'Semantic Scholar paper detail (citation graph + AI tldr) by paperId, DOI, or arXiv id',
    domain: 'api.semanticscholar.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'paperId (40-char hex), DOI, arXiv id, or prefixed id (e.g. "ARXIV:1706.03762", "PMID:12345")' },
    ],
    columns: ['paperId', 'doi', 'title', 'year', 'firstAuthor', 'citationCount', 'influentialCitationCount', 'referenceCount', 'tldr', 'url'],
    func: async (args) => {
        const ref = requirePaperRef(args.id);
        const url = `${S2_GRAPH_BASE}/paper/${encodeURIComponent(ref)}?fields=${FIELDS}`;
        const body = await s2Fetch(url, 'semanticscholar paper');

        if (!body || typeof body !== 'object') {
            throw new CommandExecutionError('semanticscholar paper returned an unexpected payload shape');
        }
        const row = normalizePaperRow(body, 'paper');

        return [{
            ...row,
            influentialCitationCount: optionalNumber(body.influentialCitationCount, 'paper influentialCitationCount'),
            referenceCount: optionalNumber(body.referenceCount, 'paper referenceCount'),
            tldr: tldrText(body.tldr),
        }];
    },
});
