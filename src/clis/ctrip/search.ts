/**
 * 携程旅行搜索 — browser cookie, multi-strategy.
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'ctrip',
  name: 'search',
  description: '携程旅行搜索',
  domain: 'www.ctrip.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword (city or attraction)' },
    { name: 'limit', type: 'int', default: 15, help: 'Number of results' },
  ],
  columns: ['rank', 'name', 'type', 'score', 'price', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 15;
    await page.goto('https://www.ctrip.com');
    await page.wait(2);
    const data = await page.evaluate(`
      (async () => {
        const query = '${kwargs.query.replace(/'/g, "\\'")}';
        const limit = ${limit};

        // Strategy 1: Suggestion API
        try {
          const suggestUrl = 'https://m.ctrip.com/restapi/h5api/searchapp/search?action=onekeyali&keyword=' + encodeURIComponent(query);
          const resp = await fetch(suggestUrl, {credentials: 'include'});
          if (resp.ok) {
            const d = await resp.json();
            const raw = d.data || d.result || d;
            if (raw && typeof raw === 'object') {
              // Flatten all result categories
              const items = [];
              for (const key of Object.keys(raw)) {
                const list = Array.isArray(raw[key]) ? raw[key] : [];
                for (const item of list) {
                  if (items.length >= limit) break;
                  items.push({
                    rank: items.length + 1,
                    name: item.word || item.name || item.title || '',
                    type: item.type || item.tpName || key,
                    score: item.score || '',
                    price: item.price || item.minPrice || '',
                    url: item.url || item.surl || '',
                  });
                }
              }
              if (items.length > 0) return items;
            }
          }
        } catch(e) {}

        return {error: 'No results for: ' + query};
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data;
  },
});
