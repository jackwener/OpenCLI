/**
 * 携程旅行搜索 — public destination and hotel suggestion lookup.
 */
import { ArgumentError, CliError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
function clampLimit(raw, fallback = 15) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed))
        return fallback;
    return Math.max(1, Math.min(Math.floor(parsed), 50));
}
function mapSearchResults(results, limit) {
    return results
        .filter((item) => !!item && typeof item === 'object')
        .slice(0, limit)
        .map((item, index) => ({
        rank: index + 1,
        name: String(item.displayName || item.word || item.cityName || '').replace(/\s+/g, ' ').trim(),
        type: String(item.displayType || item.type || '').replace(/\s+/g, ' ').trim(),
        score: item.commentScore ?? item.cStar ?? '',
        price: item.price ?? item.minPrice ?? '',
        url: '',
    }))
        .filter((item) => item.name);
}
cli({
    site: 'ctrip',
    name: 'search',
    description: '搜索携程目的地、景区和酒店联想结果',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword (city or attraction)' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
    ],
    columns: ['rank', 'name', 'type', 'score', 'price', 'url'],
    func: async (_page, kwargs) => {
        const query = String(kwargs.query || '').trim();
        if (!query) {
            throw new ArgumentError('Search keyword cannot be empty');
        }
        const limit = clampLimit(kwargs.limit);
        const response = await fetch('https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                keyword: query,
                searchType: 'D',
                platform: 'online',
                pageID: '102001',
                head: {
                    Locale: 'zh-CN',
                    LocaleController: 'zh_cn',
                    Currency: 'CNY',
                    PageId: '102001',
                    clientID: 'opencli-ctrip-search',
                    group: 'ctrip',
                    Frontend: {
                        sessionID: 1,
                        pvid: 1,
                    },
                    HotelExtension: {
                        group: 'CTRIP',
                        WebpSupport: false,
                    },
                },
            }),
        });
        if (!response.ok) {
            throw new CliError('FETCH_ERROR', `ctrip search failed with status ${response.status}`, 'Retry the command or verify ctrip.com is reachable');
        }
        const payload = await response.json();
        const rawResults = Array.isArray(payload?.Response?.searchResults) ? payload.Response.searchResults : [];
        const results = mapSearchResults(rawResults, limit);
        if (!results.length) {
            throw new EmptyResultError('ctrip search', 'Try a destination, scenic spot, or hotel keyword such as "苏州" or "朱家尖"');
        }
        return results;
    },
});
export const __test__ = {
    clampLimit,
    mapSearchResults,
};
