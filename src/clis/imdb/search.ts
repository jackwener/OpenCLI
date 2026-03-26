import { ArgumentError, CommandExecutionError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import {
  forceEnglishUrl,
  isChallengePage,
  normalizeImdbTitleType,
  waitForImdbPath,
  waitForImdbSearchReady,
} from './utils.js';

/**
 * Search IMDb via the public search page and parse Next.js payload first.
 */
cli({
  site: 'imdb',
  name: 'search',
  description: 'Search IMDb for movies, TV shows, and people',
  domain: 'www.imdb.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'id', 'title', 'year', 'type', 'url'],
  func: async (page, args) => {
    const query = String(args.query || '').trim();
    // Reject empty or whitespace-only queries early
    if (!query) {
      throw new ArgumentError('Search query cannot be empty');
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 20, 50));
    const url = forceEnglishUrl(`https://www.imdb.com/find/?q=${encodeURIComponent(query)}&ref_=nv_sr_sm`);

    await page.goto(url);
    const onSearchPage = await waitForImdbPath(page, '^/find/?$');
    const searchReady = await waitForImdbSearchReady(page, 15000);

    if (await isChallengePage(page)) {
      throw new CommandExecutionError(
        'IMDb blocked this request',
        'Try again with a normal browser session or extension mode',
      );
    }
    if (!onSearchPage || !searchReady) {
      throw new CommandExecutionError(
        'IMDb search results did not finish loading',
        'Retry the command; if it persists, the search page structure may have changed',
      );
    }

    const results = await page.evaluate(`
      (function() {
        var results = [];

        function pushResult(item) {
          if (!item || !item.id || !item.title) {
            return;
          }
          results.push(item);
        }

        var nextDataEl = document.getElementById('__NEXT_DATA__');
        if (nextDataEl) {
          try {
            var nextData = JSON.parse(nextDataEl.textContent || 'null');
            var pageProps = nextData && nextData.props && nextData.props.pageProps;
            if (pageProps) {
              // IMDb wraps results as {index: "tt...", listItem: {...}}
              var titleResults = (pageProps.titleResults && pageProps.titleResults.results) || [];
              for (var i = 0; i < titleResults.length; i++) {
                var tr = titleResults[i] || {};
                var tItem = tr.listItem || {};
                var tId = tr.index || '';
                var tTitle = typeof tItem.originalTitleText === 'string'
                  ? tItem.originalTitleText
                  : (tItem.originalTitleText && tItem.originalTitleText.text) || '';
                if (!tTitle) {
                  tTitle = typeof tItem.titleText === 'string'
                    ? tItem.titleText
                    : (tItem.titleText && tItem.titleText.text) || '';
                }
                var tYear = '';
                if (typeof tItem.releaseYear === 'number' || typeof tItem.releaseYear === 'string') {
                  tYear = String(tItem.releaseYear);
                } else if (tItem.releaseYear && typeof tItem.releaseYear === 'object') {
                  tYear = String(tItem.releaseYear.year || '');
                }
                pushResult({
                  id: tId,
                  title: tTitle,
                  year: tYear,
                  type: tItem.titleType || (tItem.endYear != null ? 'tvSeries' : ''),
                  url: tId ? 'https://www.imdb.com/title/' + tId + '/' : ''
                });
              }

              var nameResults = (pageProps.nameResults && pageProps.nameResults.results) || [];
              for (var j = 0; j < nameResults.length; j++) {
                var nr = nameResults[j] || {};
                var nItem = nr.listItem || {};
                var nId = nr.index || '';
                var nTitle = typeof nItem.nameText === 'string'
                  ? nItem.nameText
                  : (nItem.nameText && nItem.nameText.text) || '';
                if (!nTitle) {
                  nTitle = typeof nItem.originalNameText === 'string'
                    ? nItem.originalNameText
                    : (nItem.originalNameText && nItem.originalNameText.text) || '';
                }
                var nType = '';
                if (typeof nItem.primaryProfession === 'string') {
                  nType = nItem.primaryProfession;
                } else if (Array.isArray(nItem.primaryProfessions) && nItem.primaryProfessions.length > 0) {
                  nType = String(nItem.primaryProfessions[0] || '');
                } else if (Array.isArray(nItem.professions) && nItem.professions.length > 0) {
                  nType = String(nItem.professions[0] || '');
                }
                pushResult({
                  id: nId,
                  title: nTitle,
                  year: nItem.knownFor && nItem.knownFor.yearRange ? String(nItem.knownFor.yearRange.year || '') : (nItem.knownForTitleYear ? String(nItem.knownForTitleYear) : ''),
                  type: nType || 'Person',
                  url: nId ? 'https://www.imdb.com/name/' + nId + '/' : ''
                });
              }
            }
          } catch (error) {
            void error;
          }
        }

        if (results.length === 0) {
          var items = document.querySelectorAll('[class*="find-title-result"], [class*="find-name-result"], .ipc-metadata-list-summary-item');
          for (var k = 0; k < items.length; k++) {
            var el = items[k];
            var linkEl = el.querySelector('a[href*="/title/"], a[href*="/name/"]');
            if (!linkEl) {
              continue;
            }

            var href = linkEl.getAttribute('href') || '';
            var idMatch = href.match(/(tt|nm)\\d{7,8}/);
            if (!idMatch) {
              continue;
            }

            var titleEl = el.querySelector('.ipc-metadata-list-summary-item__t, h3, a');
            var metaEls = el.querySelectorAll('.ipc-metadata-list-summary-item__li, span');
            var absoluteUrl = href.startsWith('http') ? href : 'https://www.imdb.com' + href.split('?')[0];

            pushResult({
              id: idMatch[0],
              title: titleEl ? (titleEl.textContent || '').trim() : '',
              year: metaEls.length > 0 ? (metaEls[0].textContent || '').trim() : '',
              type: metaEls.length > 1 ? (metaEls[1].textContent || '').trim() : '',
              url: absoluteUrl
            });
          }
        }

        return results;
      })()
    `);

    if (!Array.isArray(results)) {
      return [];
    }

    return results.slice(0, limit).map((item: any, index: number) => ({
      rank: index + 1,
      id: item.id || '',
      title: item.title || '',
      year: item.year || '',
      type: normalizeImdbTitleType(item.type),
      url: item.url || '',
    }));
  },
});
