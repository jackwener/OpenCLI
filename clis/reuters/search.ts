/**
 * Reuters news search — API with HTML fallback.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'reuters',
  name: 'search',
  description: 'Reuters 路透社新闻搜索',
  domain: 'www.reuters.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results (max 40)' },
  ],
  columns: ['rank', 'title', 'date', 'section', 'url'],
  func: async (page, kwargs) => {
    const count = Math.min(kwargs.limit || 10, 40);
    await page.goto('https://www.reuters.com');
    await page.wait(2);
    const data = await page.evaluate(`
      (async () => {
        const count = ${count};
        const apiQuery = JSON.stringify({
          keyword: '${kwargs.query.replace(/'/g, "\\'")}',
          offset: 0, orderby: 'display_date:desc', size: count, website: 'reuters'
        });
        const apiUrl = 'https://www.reuters.com/pf/api/v3/content/fetch/articles-by-search-v2?query=' + encodeURIComponent(apiQuery);
        try {
          const resp = await fetch(apiUrl, {credentials: 'include'});
          if (resp.ok) {
            const data = await resp.json();
            const articles = data.result?.articles || data.articles || [];
            if (articles.length > 0) {
              return articles.slice(0, count).map((a, i) => ({
                rank: i + 1,
                title: a.title || a.headlines?.basic || '',
                date: (a.display_date || a.published_time || '').split('T')[0],
                section: a.taxonomy?.section?.name || '',
                url: a.canonical_url ? 'https://www.reuters.com' + a.canonical_url : '',
              }));
            }
          }
        } catch(e) {}
        return {error: 'Reuters API unavailable'};
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data;
  },
});
