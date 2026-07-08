/**
 * 携程酒店 hotel-context suggest — public city/business-area/hotel lookup.
 *
 * Distinct from `ctrip/search` (destination): the same backing endpoint is
 * called with `searchType=H`, surfacing Hotel and BusinessArea rows that the
 * destination flavour does not return.
 */
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchSuggest, mapSuggestRow, parseLimit } from './utils.js';

cli({
    site: 'ctrip',
    name: 'hotel-suggest',
    access: 'read',
    description: '搜索携程酒店上下文联想：城市、商圈、单酒店匹配',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword (city, business area, or hotel name)' },
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
        const raw = await fetchSuggest(query, 'H');
        const rows = raw
            .filter((item) => !!item && typeof item === 'object')
            .slice(0, limit)
            .map(mapSuggestRow)
            .filter((row) => row.name);
        if (!rows.length) {
            throw new EmptyResultError('ctrip hotel-suggest', 'Try a city, business area, or hotel keyword such as "陆家嘴" or "汉庭酒店"');
        }
        return rows;
    },
});
