/**
 * 携程旅行搜索 — browser cookie, multi-strategy.
 */
import { ArgumentError, CliError, EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'ctrip',
  name: 'search',
  description: '搜索携程目的地、景区和酒店联想结果',
  domain: 'www.ctrip.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (city or attraction)' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['rank', 'name', 'type', 'score', 'price', 'url'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Number(kwargs.limit) || 15);
    const query = String(kwargs.query || '').trim();
    if (!query) {
      throw new ArgumentError('Search keyword cannot be empty');
    }

    await page.goto('https://www.ctrip.com');
    await page.wait(2);

    const data = await page.evaluate(`
      (async () => {
        const query = ${JSON.stringify(query)};
        const limit = ${limit};
        const cleanText = (text) => (text || '').replace(/\\s+/g, ' ').trim();
        const clientId = (() => {
          try {
            return globalThis.localStorage?.GUID
              || document.cookie.match(/(?:^|; )GUID=([^;]+)/)?.[1]
              || 'opencli-ctrip-search';
          } catch {
            return 'opencli-ctrip-search';
          }
        })();

        try {
          const response = await fetch('https://m.ctrip.com/restapi/soa2/21881/json/gaHotelSearchEngine', {
            method: 'POST',
            credentials: 'include',
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
                clientID: clientId,
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
            return {
              ok: false,
              error: 'ctrip search failed with status ' + response.status,
            };
          }

          const payload = await response.json();
          const results = Array.isArray(payload?.Response?.searchResults) ? payload.Response.searchResults : [];
          return {
            ok: true,
            results: results
              .slice(0, limit)
              .map((item, index) => ({
                rank: index + 1,
                name: cleanText(item.displayName || item.word || item.cityName || ''),
                type: cleanText(item.displayType || item.type || ''),
                score: item.commentScore || item.cStar || '',
                price: item.price || item.minPrice || '',
                url: '',
              }))
              .filter((item) => item.name),
          };
        } catch (error) {
          return {
            ok: false,
            error: String(error && error.message ? error.message : error),
          };
        }
      })()
    `);
    if (!data || typeof data !== 'object') {
      throw new CliError('FETCH_ERROR', 'ctrip search returned an invalid response', 'Retry the command or check the adapter');
    }
    if (!data.ok) {
      throw new CliError('FETCH_ERROR', String(data.error || 'ctrip search failed'), 'Retry the command or verify ctrip.com is reachable');
    }
    if (!Array.isArray(data.results) || data.results.length === 0) {
      throw new EmptyResultError('ctrip search', 'Try a destination, scenic spot, or hotel keyword such as "苏州" or "朱家尖"');
    }
    return data.results;
  },
});
