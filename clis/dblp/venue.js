// dblp venue — search dblp's venue (conference / journal) registry.
//
// Hits `https://dblp.org/search/venue/api?q=…&format=json&h=…`. Returns a
// row per matched venue. Useful for resolving an acronym (e.g. "ICLR" →
// dblp's canonical venue page) and for browsing venues that match a topic.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    DBLP_ORIGIN,
    decodeXmlEntities,
    dblpFetchJson,
    requireBoundedInt,
    requireQuery,
} from './utils.js';

function simplifyVenueType(type) {
    const t = String(type ?? '').trim();
    if (!t) return '';
    if (/Conference or Workshop/i.test(t)) return 'conf';
    if (/Journal/i.test(t)) return 'journal';
    if (/Series/i.test(t)) return 'series';
    if (/Book/i.test(t)) return 'book';
    if (/Reference/i.test(t)) return 'reference';
    return t.toLowerCase().split(/\s+/)[0];
}

function venueHitToRow(hit, rank) {
    const info = hit?.info ?? {};
    const url = String(info.url ?? '').trim();
    return {
        rank,
        acronym: String(info.acronym ?? '').trim(),
        venue: decodeXmlEntities(info.venue ?? ''),
        type: simplifyVenueType(info.type),
        url: url.startsWith('http') ? url : url ? `${DBLP_ORIGIN}${url.startsWith('/') ? '' : '/'}${url}` : '',
    };
}

cli({
    site: 'dblp',
    name: 'venue',
    access: 'read',
    description: 'Search dblp venue registry (conferences / journals) by name or acronym',
    domain: 'dblp.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Venue name or acronym (e.g. "ICLR", "neural networks")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max venues (1-100, single dblp page)' },
    ],
    columns: ['rank', 'acronym', 'venue', 'type', 'url'],
    func: async (args) => {
        const query = requireQuery(args.query);
        const limit = requireBoundedInt(args.limit, 20, 100);
        const path = `/search/venue/api?q=${encodeURIComponent(query)}&format=json&h=${limit}`;
        const json = await dblpFetchJson(path, 'dblp venue');
        const hits = json?.result?.hits?.hit;
        const list = Array.isArray(hits) ? hits : [];
        if (list.length === 0) {
            throw new EmptyResultError('dblp venue', `No dblp venues matched "${query}".`);
        }
        return list.slice(0, limit).map((hit, i) => venueHitToRow(hit, i + 1));
    },
});
