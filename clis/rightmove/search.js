import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    SEARCH_COLUMNS,
    buildLocationIdentifier,
    buildSearchUrl,
    fetchSearchResults,
    normalizeBbox,
    normalizeChannel,
    normalizeIndex,
    normalizeOptionalInt,
    normalizePolygon,
    normalizePositiveInt,
    normalizeRadius,
    normalizeSort,
    parseBool,
    propertyToRow,
} from './utils.js';

cli({
    site: 'rightmove',
    name: 'search',
    access: 'read',
    description: 'Search Rightmove property listings by postcode, outcode, region, bounding box, or drawn polygon',
    domain: 'www.rightmove.co.uk',
    strategy: Strategy.PUBLIC,
    browser: false,
    example: 'opencli rightmove search "SW1A 1AA" --radius 1 --limit 10 -f yaml',
    args: [
        { name: 'location', positional: true, required: false, help: 'Rightmove location text, outcode, or postcode (e.g. London, W12, "SW1A 1AA")' },
        { name: 'radius', type: 'float', default: 0, help: 'Radius in miles around a resolved location (0-40)' },
        { name: 'channel', type: 'string', default: 'buy', choices: ['buy', 'rent'], help: 'Listing channel: buy or rent' },
        { name: 'sort', type: 'string', default: 'highest', choices: ['highest', 'lowest', 'newest', 'oldest'], help: 'Sort order' },
        { name: 'min-price', type: 'int', help: 'Minimum price' },
        { name: 'max-price', type: 'int', help: 'Maximum price' },
        { name: 'min-beds', type: 'int', help: 'Minimum bedrooms' },
        { name: 'max-beds', type: 'int', help: 'Maximum bedrooms' },
        { name: 'index', type: 'int', default: 0, help: 'Pagination offset (0, 24, 48, ...)' },
        { name: 'limit', type: 'int', default: 24, help: 'Max rows to return (1-100)' },
        { name: 'include-sstc', type: 'bool', default: true, help: 'Include sold subject to contract listings' },
        { name: 'bbox', type: 'string', default: '', help: 'Advanced: west,east,north,south bounding box' },
        { name: 'polygon', type: 'string', default: '', help: 'Advanced: encoded polyline, JSON [[lat,lng]], or lat,lng;lat,lng points' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (args) => {
        const channel = normalizeChannel(args.channel);
        const sortType = normalizeSort(args.sort);
        const index = normalizeIndex(args.index);
        const limit = normalizePositiveInt(args.limit, 24, 100, 'limit');
        const radius = normalizeRadius(args.radius);
        const minPrice = normalizeOptionalInt(args['min-price'], 'min-price');
        const maxPrice = normalizeOptionalInt(args['max-price'], 'max-price');
        const minBeds = normalizeOptionalInt(args['min-beds'], 'min-beds');
        const maxBeds = normalizeOptionalInt(args['max-beds'], 'max-beds');
        const includeSstc = parseBool(args['include-sstc'], true);
        const bbox = normalizeBbox(args.bbox);
        const polygon = normalizePolygon(args.polygon);
        const location = await buildLocationIdentifier({ query: args.location, bbox, polygon });

        const url = buildSearchUrl({
            channel,
            sortType,
            index,
            limit,
            radius,
            minPrice,
            maxPrice,
            minBeds,
            maxBeds,
            includeSstc,
            locationIdentifier: location.identifier,
            searchLocation: location.searchLocation ?? location.displayName,
            displayLocationIdentifier: location.displayLocationIdentifier,
        });

        const data = await fetchSearchResults(url);
        return data.properties
            .slice(0, limit)
            .map((property, i) => propertyToRow(property, index + i + 1));
    },
});
