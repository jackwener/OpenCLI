import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

function buildExtractorJs(limit) {
  return `
(function() {
  var results = [];
  var seen = {};
  var items = document.querySelectorAll('.snippet');
  for (var i = 0; i < items.length; i++) {
    if (results.length >= ${limit}) break;
    var el = items[i];
    if (el.classList.contains('standalone')) continue;
    var titleEl = el.querySelector('.search-snippet-title');
    var snippetEl = el.querySelector('.generic-snippet .content');
    var linkEl = el.querySelector('.result-content a');
    if (!titleEl) continue;
    var title = titleEl.textContent.trim();
    var href = linkEl ? linkEl.getAttribute('href') || '' : '';
    var snippet = snippetEl ? snippetEl.textContent.trim() : '';
    if (!title || !href || seen[title]) continue;
    if (href.indexOf('/') === 0) continue;
    seen[title] = true;
    results.push({ title: title, url: href, snippet: snippet });
  }
  return { items: results };
})()`;
}

const command = cli({
  site: 'brave',
  name: 'search',
  access: 'read',
  description: 'Search Brave Search',
  domain: 'search.brave.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'keyword', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results per page (max 18)' },
    { name: 'offset', type: 'int', default: 0, help: 'Page offset (0, 1, 2...). Brave returns ~18 results per page' },
  ],
  columns: ['title', 'url', 'snippet'],
  func: async (page, kwargs) => {
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 10, 18));
    const keyword = encodeURIComponent(String(kwargs.keyword));
    const offset = Math.max(0, Number(kwargs.offset) || 0);
    let url = `https://search.brave.com/search?q=${keyword}`;
    if (offset > 0) url += `&offset=${offset}`;
    await page.goto(url);
    try {
      await page.wait({ selector: '.snippet', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    const wrapper = await page.evaluate(buildExtractorJs(limit));
    const results = (wrapper && wrapper.items) || [];
    if (results.length === 0) {
      throw new CliError('NOT_FOUND', 'No search results found', 'Try a different keyword');
    }
    return results;
  },
});

export const __test__ = { command };
