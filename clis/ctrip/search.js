/**
 * 携程旅行 destination suggest — public city/landmark/scenic-spot lookup.
 */
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchSuggest, mapSuggestRow, parseLimit } from './utils.js';

cli({
    site: 'ctrip',
    name: 'search',
    access: 'read',
    description: '搜索携程目的地、景区、火车站和地标联想结果',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword (city, scenic spot, landmark)' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of results (1-50)' },
    ],
    columns: [
        'rank', 'id', 'type', 'displayType', 'name', 'eName',
        'cityId', 'cityName', 'provinceName', 'countryName',
        'lat', 'lon', 'score', 'url',
    ],
    func: async (kwargs) => {
        const query = String(kwargs.query || '').trim();
        if (!query) {
            throw new ArgumentError('Search keyword cannot be empty');
        }
        const limit = parseLimit(kwargs.limit);
        const raw = await fetchSuggest(query, 'D');
        const rows = raw
            .filter((item) => !!item && typeof item === 'object')
            .slice(0, limit)
            .map(mapSuggestRow)
            .filter((row) => row.name);
        if (!rows.length) {
            throw new EmptyResultError('ctrip search', 'Try a destination, scenic spot, or landmark keyword such as "苏州" or "故宫"');
        }
        return rows;
    },
});
