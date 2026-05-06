// gbif species — search the GBIF Backbone Taxonomy.
//
// Endpoint: GET /v1/species/search?datasetKey=<backbone>&q=<query>&limit=<N>
//
// We scope to GBIF's canonical Backbone dataset (datasetKey
// `d7dddbf4-2cf0-4f39-9b2a-bb099caae36c`) so every row carries the full
// kingdom→species lineage. Without this filter, third-party datasets
// dominate the results and most rows have empty kingdom/phylum/class/etc.
// fields — a silent-empty-column trap.
//
// Returns one row per matched name with the GBIF taxon key (round-trips
// into URL `https://www.gbif.org/species/<key>` and into `gbif occurrence
// --taxon-key <key>`).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    GBIF_BASE,
    gbifFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

const BACKBONE_DATASET_KEY = 'd7dddbf4-2cf0-4f39-9b2a-bb099caae36c';

cli({
    site: 'gbif',
    name: 'species',
    access: 'read',
    description: 'Search the GBIF Backbone Taxonomy (species, genera, families)',
    domain: 'api.gbif.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Species or scientific name (e.g. "Panthera leo")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-100, default 20)' },
    ],
    columns: [
        'rank', 'taxonKey', 'scientificName', 'canonicalName', 'rank_taxon',
        'taxonomicStatus', 'kingdom', 'phylum', 'class', 'order',
        'family', 'genus', 'species', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${GBIF_BASE}/species/search?datasetKey=${BACKBONE_DATASET_KEY}&q=${encodeURIComponent(query)}&limit=${limit}`;
        const body = await gbifFetch(url, 'gbif species');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('gbif species', `GBIF returned no species matches for "${query}".`);
        }
        return list.slice(0, limit).map((s, i) => {
            const taxonKey = s.nubKey != null ? Number(s.nubKey) : (s.key != null ? Number(s.key) : null);
            return {
                rank: i + 1,
                taxonKey,
                scientificName: String(s.scientificName ?? '').trim(),
                canonicalName: String(s.canonicalName ?? '').trim(),
                rank_taxon: String(s.rank ?? '').trim(),
                taxonomicStatus: String(s.taxonomicStatus ?? '').trim(),
                kingdom: String(s.kingdom ?? '').trim(),
                phylum: String(s.phylum ?? '').trim(),
                class: String(s.class ?? '').trim(),
                order: String(s.order ?? '').trim(),
                family: String(s.family ?? '').trim(),
                genus: String(s.genus ?? '').trim(),
                species: String(s.species ?? '').trim(),
                url: taxonKey != null ? `https://www.gbif.org/species/${taxonKey}` : '',
            };
        });
    },
});
