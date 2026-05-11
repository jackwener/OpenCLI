/**
 * Google Web Search via browser DOM extraction.
 * Uses browser mode to navigate google.com and extract results from the DOM.
 *
 * Extraction strategy (2026-03): Google no longer uses `.g` class containers.
 * Instead, we find all `a` tags containing `h3` within `#rso`, then walk up
 * to the result container (`div.tF2Cxc` or closest `div[data-hveid]`) to find
 * snippets. This approach is resilient to class name changes.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
cli({
    site: 'google',
    name: 'search',
    access: 'read',
    description: 'Search Google',
    domain: 'google.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results (1-100)' },
        { name: 'lang', default: 'en', help: 'Language short code (e.g. en, zh)' },
    ],
    columns: ['type', 'title', 'url', 'snippet'],
    func: async (page, args) => {
        const limit = Math.max(1, Math.min(Number(args.limit), 100));
        const keyword = encodeURIComponent(args.keyword);
        const lang = encodeURIComponent(args.lang);
        const url = `https://www.google.com/search?q=${keyword}&hl=${lang}&num=${limit}`;
        await page.goto(url);
        await page.wait(2);
        const results = await page.evaluate(`
      (function() {
        var results = [];
        var seenUrls = {};
        var rso = document.querySelector('#rso');
        if (!rso) return results;

        // -- Featured snippet (scoped to #rso to avoid matching unrelated elements) --
        var featuredEl = rso.querySelector('.xpdopen .hgKElc')
                      || rso.querySelector('.IZ6rdc');
        if (featuredEl) {
          var parentBlock = featuredEl.closest('[data-hveid]') || featuredEl.parentElement;
          var fLink = parentBlock ? parentBlock.querySelector('a[href]') : null;
          var fUrl = fLink ? fLink.href : '';
          if (fUrl) seenUrls[fUrl] = true;
          results.push({
            type: 'snippet',
            title: featuredEl.textContent.trim().slice(0, 200),
            url: fUrl,
            snippet: '',
          });
        }

        // -- Standard search results --
        // Strategy: find all links containing h3 within #rso
        var allLinks = rso.querySelectorAll('a');
        for (var i = 0; i < allLinks.length; i++) {
          var link = allLinks[i];
          var h3 = link.querySelector('h3');
          if (!h3) continue;

          var href = link.href || '';
          // Skip non-http, Google internal links, and duplicates
          if (!href.match(/^https?:\\/\\//)) continue;
          if (href.indexOf('google.com/search') !== -1) continue;
          if (seenUrls[href]) continue;
          seenUrls[href] = true;

          // Walk up to find result container for snippet extraction
          var container = link;
          for (var j = 0; j < 6; j++) {
            if (container.parentElement && container.parentElement !== rso) {
              container = container.parentElement;
            }
            // Stop at a known result boundary
            if (container.getAttribute && container.getAttribute('data-hveid')) break;
          }

          // Find snippet: look for descriptive text, skip breadcrumbs and metadata
          var snippetText = '';
          var titleText = h3.textContent.trim();
          var candidates = container.querySelectorAll('span, div');
          for (var k = 0; k < candidates.length; k++) {
            var el = candidates[k];
            if (el.querySelector('h3') || el.querySelector('a[href]')) continue;
            var text = el.textContent.trim();
            if (text.length < 40 || text.length > 500) continue;
            if (text === titleText) continue;
            // Skip URL breadcrumbs (e.g. "https://example.com › path..." or "Site Namehttps://...")
            if (text.indexOf('\u203A') !== -1) continue;
            if (new RegExp('https?://').test(text.slice(0, 60))) continue;
            snippetText = text;
            break;
          }

          results.push({
            type: 'result',
            title: h3.textContent.trim(),
            url: href,
            snippet: snippetText.slice(0, 300),
          });
        }

        // -- People Also Ask --
        var paaContainers = document.querySelectorAll('[data-sgrd="true"]');
        for (var i = 0; i < paaContainers.length; i++) {
          var questionEl = paaContainers[i].querySelector('span.CSkcDe');
          if (questionEl) {
            results.push({
              type: 'paa',
              title: questionEl.textContent.trim(),
              url: '',
              snippet: '',
            });
          }
        }

        return results;
      })()
    `);
        if (!Array.isArray(results) || results.length === 0) {
            throw new CliError('NOT_FOUND', 'No search results found', 'Try a different keyword or check for CAPTCHA');
        }
        return results;
    },
});
