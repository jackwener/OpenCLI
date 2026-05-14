import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { clampInt } from '../_shared/common.js';

function decodeYahooUrl(href) {
  if (!href) return '';
  if (href.indexOf('RU=') !== -1 && href.indexOf('/RK=') !== -1) {
    var match = href.match(/RU=([^/]+)\/RK=/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return href;
      }
    }
  }
  return href;
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
    if (!title || !href || seen[title]) continue;
    seen[title] = true;
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
  columns: ['title', 'url', 'snippet'],
  func: async (page, kwargs) => {
    const limit = clampInt(kwargs.limit, 7, 1, 7);
    const keyword = encodeURIComponent(String(kwargs.keyword));
    const pageNum = Math.max(1, Number(kwargs.page) || 1);
    var url = `https://search.yahoo.com/search?p=${keyword}`;
    if (pageNum > 1) url += `&b=${(pageNum - 1) * 7 + 1}`;
    await page.goto(url);
    try {
      await page.wait({ selector: '.algo', timeout: 10 });
    } catch {
      await page.wait(3).catch(function() {});
    }
    const raw = await page.evaluate(buildExtractorJs(limit));
    const results = (raw && Array.isArray(raw)) ? raw : [];
    if (results.length === 0) {
      throw new CliError('NOT_FOUND', 'No search results found', 'Try a different keyword');
    }
    return results.map(function(r) {
      return { title: r[0], url: decodeYahooUrl(r[1]), snippet: r[2] };
    });
  },
});

export const __test__ = { command };
