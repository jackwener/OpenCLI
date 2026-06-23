// semanticscholar search: paper search across the Semantic Scholar graph.
//
// Hits `/paper/search?query=...`. Returns the agent-useful projection:
// paperId (round-trips into `semanticscholar paper`), DOI, title, year,
// first author, citationCount. The bulk search endpoint is the rate-limited
// surface, so `utils.s2Fetch` retries once on 429.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    S2_GRAPH_BASE,
    normalizePaperRow,
    requireBoundedInt,
    requireString,
    s2Fetch,
} from './utils.js';

const FIELDS = ['paperId', 'title', 'year', 'authors', 'citationCount', 'externalIds'].join(',');

cli({
    site: 'semanticscholar',
    name: 'search',
    access: 'read',
    description: 'Search Semantic Scholar papers by free text',
    domain: 'api.semanticscholar.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search text (e.g. "attention is all you need", "diffusion model")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max papers (1-100, single Semantic Scholar page)' },
    ],
    columns: ['rank', 'paperId', 'doi', 'title', 'year', 'firstAuthor', 'citationCount', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${S2_GRAPH_BASE}/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${FIELDS}`;
        const body = await s2Fetch(url, 'semanticscholar search');

        const data = Array.isArray(body?.data) ? body.data : null;
        if (data === null) {
            throw new CommandExecutionError('semanticscholar search returned an unexpected payload shape');
        }
        if (!data.length) {
            throw new EmptyResultError('semanticscholar search', `No Semantic Scholar papers matched "${query}".`);
        }

        return data.slice(0, limit).map((p, i) => normalizePaperRow(p, 'search', { rank: i + 1 }));
    },
});
