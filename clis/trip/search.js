/**
 * Trip.com (international) destination suggest.
 *
 * Trip.com's flight / hotel search boxes resolve a keyword through a public,
 * unsigned POI-search endpoint, so this is a plain public fetch (no browser) that
 * returns the city / airport matches. The `cityId` feeds `hotel-search` / `car` /
 * `tour`, and the `airportCode` feeds `flight` / `transfer`, so `search` is the
 * discovery step for the id-based commands (see `fetchPoiSearch` in utils).
 */
import { EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchPoiSearch, flattenPoiResults, mapSearchRow, parseKeyword, parseListLimit } from './utils.js';

cli({
    site: 'trip',
    name: 'search',
    access: 'read',
    description: 'Suggest Trip.com destinations (cities, airports) for a keyword; resolves the ids the other commands take',
    domain: 'trip.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Destination keyword (e.g. Tokyo / Bali / London)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of suggestions (1-50)' },
    ],
    columns: [
        'rank',
        'name', 'type',
        'cityId', 'airportCode',
        'province', 'country',
    ],
    func: async (kwargs) => {
        const query = parseKeyword('query', kwargs.query);
        const limit = parseListLimit(kwargs.limit);

        const results = await fetchPoiSearch(query);
        const items = flattenPoiResults(results).filter((item) => item && item.name);
        if (items.length === 0) {
            throw new EmptyResultError('trip search', `No destinations for "${query}"`);
        }
        return items.slice(0, limit).map((item, i) => mapSearchRow(item, i));
    },
});
