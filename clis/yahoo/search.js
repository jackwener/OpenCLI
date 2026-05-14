import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  emptySearchResults,
  requireBoundedInteger,
  requireRows,
  requireSearchQuery,
  runBrowserStep,
  toHttpsUrl,
} from '../_shared/search-adapter.js';

function decodeYahooUrl(href) {
  if (!href) return '';
  if (href.indexOf('RU=') !== -1 && href.indexOf('/RK=') !== -1) {
    var match = href.match(/RU=([^/]+)\/RK=/);
    if (match && match[1]) {
      try {
        return toHttpsUrl(decodeURIComponent(match[1]), 'https://search.yahoo.com');
      } catch {
        return toHttpsUrl(href, 'https://search.yahoo.com');
      }
    }
  }
  return toHttpsUrl(href, 'https://search.yahoo.com');
}

function buildExtractorJs(limit) {
  return `
(function() {
  var results = [];
  var seen = {};
  var items = document.querySelectorAll('.algo');
  for (var i = 0; i < items.length; i++) {
    if (results.length >= ${limit}) break;
    var el = items[i];
    var h3 = el.querySelector('h3');
    var linkEl = el.querySelector('.compTitle a');
    var snippetEl = el.querySelector('.compText');
    if (!h3 || !linkEl) continue;
    var title = h3.textContent.trim();
    var href = linkEl.getAttribute('href') || '';
    var snippet = snippetEl ? snippetEl.textContent.trim() : '';
    if (!title || !href || seen[href]) continue;
    seen[href] = true;
    results.push([title, href, snippet]);
  }
  return results;
})()`;
}

const command = cli({
  site: 'yahoo',
  name: 'search',
  access: 'read',
  description: 'Search Yahoo (powered by Bing)',
  domain: 'search.yahoo.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'keyword', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 7, help: 'Number of results per page (max 7)' },
    { name: 'page', type: 'int', default: 1, help: 'Page number (1, 2, 3...). Yahoo returns ~7 results per page' },
  ],
  columns: ['rank', 'title', 'url', 'snippet'],
  func: async (page, kwargs) => {
    const limit = requireBoundedInteger(kwargs.limit, 7, 1, 7, '--limit');
    const query = requireSearchQuery(kwargs.keyword);
    const keyword = encodeURIComponent(query);
    const pageNum = requireBoundedInteger(kwargs.page, 1, 1, 100, '--page');
    var url = `https://search.yahoo.com/search?p=${keyword}`;
    if (pageNum > 1) url += `&b=${(pageNum - 1) * 7 + 1}`;
    await runBrowserStep('yahoo search navigation', () => page.goto(url));
    try {
      await page.wait({ selector: '.algo', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    const raw = await runBrowserStep('yahoo search extraction', () => page.evaluate(buildExtractorJs(limit)));
    const results = requireRows(raw, 'yahoo search');
    if (results.length === 0) {
      throw emptySearchResults('Yahoo', query);
    }
    const rows = results
      .map(function(r, index) {
        return { rank: index + 1 + (pageNum - 1) * 7, title: r[0], url: decodeYahooUrl(r[1]), snippet: r[2] };
      })
      .filter((row) => row.url);
    if (rows.length === 0) throw emptySearchResults('Yahoo', query);
    return rows;
  },
});

export const __test__ = { command };
