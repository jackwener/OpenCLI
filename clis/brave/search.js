import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  emptySearchResults,
  requireBoundedInteger,
  requireNonNegativeInteger,
  requireRows,
  requireSearchQuery,
  runBrowserStep,
  toHttpsUrl,
} from '../_shared/search-adapter.js';

function buildExtractorJs(limit) {
  return `
(function() {
  var results = [];
  var seen = {};
  var items = document.querySelectorAll('.snippet');
  for (var i = 0; i < items.length; i++) {
    if (results.length >= ${limit}) break;
    var el = items[i];
    if (el.classList.contains('standalone') || el.classList.contains('ad')) continue;
    var titleEl = el.querySelector('.search-snippet-title');
    var snippetEl = el.querySelector('.generic-snippet .content');
    var linkEl = el.querySelector('.result-content a');
    if (!titleEl) continue;
    var title = titleEl.textContent.trim();
    var href = linkEl ? linkEl.getAttribute('href') || '' : '';
    var snippet = snippetEl ? snippetEl.textContent.trim() : '';
    if (!title || !href || seen[href]) continue;
    if (href.indexOf('/') === 0) continue;
    seen[href] = true;
    results.push([title, href, snippet]);
  }
  return results;
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
  columns: ['rank', 'title', 'url', 'snippet'],
  func: async (page, kwargs) => {
    const limit = requireBoundedInteger(kwargs.limit, 10, 1, 18, '--limit');
    const query = requireSearchQuery(kwargs.keyword);
    const keyword = encodeURIComponent(query);
    const offset = requireNonNegativeInteger(kwargs.offset, 0, '--offset');
    let url = `https://search.brave.com/search?q=${keyword}`;
    if (offset > 0) url += `&offset=${offset}`;
    await runBrowserStep('brave search navigation', () => page.goto(url));
    try {
      await page.wait({ selector: '.snippet', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    const raw = await runBrowserStep('brave search extraction', () => page.evaluate(buildExtractorJs(limit)));
    const results = requireRows(raw, 'brave search');
    if (results.length === 0) {
      throw emptySearchResults('Brave', query);
    }
    const rows = results
      .map(function(r, index) {
        return { rank: index + 1 + offset * 18, title: r[0], url: toHttpsUrl(r[1], 'https://search.brave.com'), snippet: r[2] };
      })
      .filter((row) => row.url);
    if (rows.length === 0) throw emptySearchResults('Brave', query);
    return rows;
  },
});

export const __test__ = { command };
