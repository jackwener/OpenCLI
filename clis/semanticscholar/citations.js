// semanticscholar citations: papers that cite this one (paginated).
//
// Hits `/paper/{ref}/citations?fields=...`. The endpoint returns
// `{ data: [{ citingPaper: { ... } }] }`; we unwrap to the citing-paper rows
// and surface fields that round-trip into `semanticscholar paper <paperId>`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    S2_GRAPH_BASE,
    normalizePaperRow,
    requireBoundedInt,
    requirePaperRef,
    s2Fetch,
} from './utils.js';

const FIELDS = ['paperId', 'title', 'year', 'authors', 'citationCount', 'externalIds'].join(',');

cli({
    site: 'semanticscholar',
    name: 'citations',
    access: 'read',
    description: 'List papers that cite a Semantic Scholar paper (paginated)',
    domain: 'api.semanticscholar.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'paperId (40-char hex), DOI, arXiv id, or prefixed id' },
        { name: 'limit', type: 'int', default: 20, help: 'Max citing papers (1-1000, single Semantic Scholar page)' },
        { name: 'offset', type: 'int', default: 0, help: 'Page offset (0-based)' },
    ],
    columns: ['rank', 'paperId', 'doi', 'title', 'year', 'firstAuthor', 'citationCount', 'url'],
    func: async (args) => {
        const ref = requirePaperRef(args.id);
        const limit = requireBoundedInt(args.limit, 20, 1000);
        const offsetRaw = args.offset ?? 0;
        const offset = typeof offsetRaw === 'number' ? offsetRaw : Number(offsetRaw);
        if (!Number.isInteger(offset) || offset < 0) {
            throw new ArgumentError('semanticscholar citations offset must be a non-negative integer');
        }
        if (offset > 9999) {
            throw new ArgumentError('semanticscholar citations offset must be <= 9999');
        }
        const url = `${S2_GRAPH_BASE}/paper/${encodeURIComponent(ref)}/citations?fields=${FIELDS}&limit=${limit}&offset=${offset}`;
        const body = await s2Fetch(url, 'semanticscholar citations');

        const data = Array.isArray(body?.data) ? body.data : null;
        if (data === null) {
            throw new CommandExecutionError('semanticscholar citations returned an unexpected payload shape');
        }
        if (!data.length) {
            throw new EmptyResultError('semanticscholar citations', `No Semantic Scholar citations for "${args.id}" at offset ${offset}.`);
        }

        return data.slice(0, limit).map((entry, i) => {
            if (!entry || typeof entry !== 'object' || !('citingPaper' in entry)) {
                throw new CommandExecutionError('semanticscholar citations row is missing citingPaper');
            }
            return normalizePaperRow(entry.citingPaper, 'citations', { rank: offset + i + 1 });
        });
    },
});
