// gbif occurrence — search GBIF's occurrence (specimen / observation) index.
//
// Endpoint: GET /v1/occurrence/search?taxonKey=…&country=…&limit=…
//
// Filters: at least one of --taxon-key (round-trips from `gbif species`)
// or --query (free text against scientificName). Optional --country (ISO
// 3166-1 alpha-2). Each row carries the GBIF occurrence key, the
// scientific name as recorded, lat/lon (often null for sensitive species),
// the event date, and source dataset.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    GBIF_BASE,
    gbifFetch,
    isoFromMillis,
    requireBoundedInt,
    requireOptionalCountry,
} from './utils.js';

cli({
    site: 'gbif',
    name: 'occurrence',
    access: 'read',
    description: 'Search GBIF biodiversity occurrence records',
    domain: 'api.gbif.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'taxon-key', help: 'GBIF taxon key (from `gbif species`)' },
        { name: 'query', help: 'Free-text scientific name search (alternative to --taxon-key)' },
        { name: 'country', help: 'ISO 3166-1 alpha-2 country code (e.g. "US", "BR")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-300, default 20)' },
    ],
    columns: [
        'rank', 'occurrenceKey', 'taxonKey', 'scientificName', 'eventDate',
        'country', 'stateProvince', 'latitude', 'longitude',
        'basisOfRecord', 'datasetName', 'recordedBy', 'url',
    ],
    func: async (args) => {
        const taxonKey = args['taxon-key'];
        const query = args.query;
        if ((taxonKey == null || taxonKey === '') && (query == null || query === '')) {
            throw new ArgumentError('gbif occurrence requires --taxon-key or --query');
        }
        const limit = requireBoundedInt(args.limit, 20, 300);
        const country = requireOptionalCountry(args.country);
        const params = new URLSearchParams({ limit: String(limit) });
        if (taxonKey != null && taxonKey !== '') {
            const n = Number(taxonKey);
            if (!Number.isInteger(n) || n <= 0) {
                throw new ArgumentError('gbif --taxon-key must be a positive integer');
            }
            params.set('taxonKey', String(n));
        }
        if (query != null && query !== '') {
            params.set('scientificName', String(query).trim());
        }
        if (country) params.set('country', country);
        const url = `${GBIF_BASE}/occurrence/search?${params.toString()}`;
        const body = await gbifFetch(url, 'gbif occurrence');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('gbif occurrence', 'GBIF returned no occurrence rows for these filters.');
        }
        return list.slice(0, limit).map((o, i) => {
            const occKey = o.key != null ? Number(o.key) : null;
            const tk = o.taxonKey != null ? Number(o.taxonKey) : null;
            return {
                rank: i + 1,
                occurrenceKey: occKey,
                taxonKey: tk,
                scientificName: String(o.scientificName ?? '').trim(),
                eventDate: o.eventDate ? String(o.eventDate) : isoFromMillis(o.eventDateSingleEpoch),
                country: String(o.country ?? '').trim(),
                stateProvince: String(o.stateProvince ?? '').trim(),
                latitude: o.decimalLatitude != null ? Number(o.decimalLatitude) : null,
                longitude: o.decimalLongitude != null ? Number(o.decimalLongitude) : null,
                basisOfRecord: String(o.basisOfRecord ?? '').trim(),
                datasetName: String(o.datasetName ?? '').trim(),
                recordedBy: String(o.recordedBy ?? '').trim(),
                url: occKey != null ? `https://www.gbif.org/occurrence/${occKey}` : '',
            };
        });
    },
});
