// semanticscholar recommendations: AI-curated related papers from Semantic
// Scholar's semantic graph. This endpoint has no equivalent in openalex or
// arxiv; it is the Semantic Scholar adapter's main differentiating surface.
//
// Hits `https://api.semanticscholar.org/recommendations/v1/papers/forpaper/{ref}`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    S2_REC_BASE,
    normalizePaperRow,
    requireBoundedInt,
    requirePaperRef,
    s2Fetch,
} from './utils.js';

const FIELDS = ['paperId', 'title', 'year', 'authors', 'citationCount', 'externalIds'].join(',');

cli({
    site: 'semanticscholar',
    name: 'recommendations',
    access: 'read',
    description: 'Semantic Scholar AI-curated related papers for a paperId, DOI, or arXiv id',
    domain: 'api.semanticscholar.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'paperId (40-char hex), DOI, arXiv id, or prefixed id' },
        { name: 'limit', type: 'int', default: 10, help: 'Max recommendations (1-500)' },
    ],
    columns: ['rank', 'paperId', 'doi', 'title', 'year', 'firstAuthor', 'citationCount', 'url'],
    func: async (args) => {
        const ref = requirePaperRef(args.id);
        const limit = requireBoundedInt(args.limit, 10, 500);
        const url = `${S2_REC_BASE}/papers/forpaper/${encodeURIComponent(ref)}?fields=${FIELDS}&limit=${limit}`;
        const body = await s2Fetch(url, 'semanticscholar recommendations');

        const recommended = Array.isArray(body?.recommendedPapers) ? body.recommendedPapers : null;
        if (recommended === null) {
            throw new CommandExecutionError('semanticscholar recommendations returned an unexpected payload shape');
        }
        if (!recommended.length) {
            throw new EmptyResultError('semanticscholar recommendations', `No Semantic Scholar recommendations for "${args.id}".`);
        }

        return recommended.slice(0, limit).map((p, i) => normalizePaperRow(p, 'recommendations', { rank: i + 1 }));
    },
});
