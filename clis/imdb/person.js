import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { forceEnglishUrl, getCurrentImdbId, isChallengePage, normalizeImdbId, waitForImdbPath, } from './utils.js';
/**
 * Read IMDb person details from public profile pages.
 */
cli({
    site: 'imdb',
    name: 'person',
    access: 'read',
    description: 'Get actor or director info',
    domain: 'www.imdb.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'id', positional: true, required: true, help: 'IMDb person ID (nm0634240) or URL' },
        { name: 'limit', type: 'int', default: 10, help: 'Max filmography entries' },
    ],
    columns: ['field', 'value'],
    func: async (page, args) => {
        const id = normalizeImdbId(String(args.id), 'nm');
        // Clamp to 30 to match the internal evaluate cap
        const limit = Math.max(1, Math.min(Number(args.limit) || 10, 30));
        const url = forceEnglishUrl(`https://www.imdb.com/name/${id}/`);
        await page.goto(url);
        const onPersonPage = await waitForImdbPath(page, `^/name/${id}/`);
        if (await isChallengePage(page)) {
            throw new CommandExecutionError('IMDb blocked this request', 'Try again with a normal browser session or extension mode');
        }
        if (!onPersonPage) {
            throw new CommandExecutionError(`Person page did not finish loading: ${id}`, 'Retry the command; if it persists, IMDb may have changed their navigation flow');
        }
        const currentId = await getCurrentImdbId(page, 'nm');
        if (currentId && currentId !== id) {
            throw new CommandExecutionError(`IMDb redirected to a different person: ${currentId}`, 'Retry the command; if it persists, the person page may have changed');
        }
        const data = await page.evaluate(`
      (function() {
        var result = {
          nameId: '',
          name: '',
          description: '',
          birthDate: '',
          filmography: []
        };

        var scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (var i = 0; i < scripts.length; i++) {
          try {
            var ld = JSON.parse(scripts[i].textContent || 'null');
            if (ld && ld['@type'] === 'Person') {
              if (typeof ld.url === 'string') {
                var ldMatch = ld.url.match(/(nm\\d{7,8})/);
                if (ldMatch) {
                  result.nameId = ldMatch[1];
                }
              }
              result.name = result.name || ld.name || '';
              result.description = result.description || ld.description || '';
              break;
            }
          } catch (error) {
            void error;
          }
        }

        var nextDataEl = document.getElementById('__NEXT_DATA__');
        if (!nextDataEl) {
          return result;
        }

        try {
          var nextData = JSON.parse(nextDataEl.textContent || 'null');
          var pageProps = nextData && nextData.props && nextData.props.pageProps;
          var above = pageProps && (pageProps.aboveTheFold || pageProps.aboveTheFoldData);
          var main = pageProps && (pageProps.mainColumnData || pageProps.belowTheFold);

          if (above) {
            if (!result.nameId && above.id) {
              result.nameId = String(above.id);
            }
            if (!result.name && above.nameText && above.nameText.text) {
              result.name = above.nameText.text;
            }

            if (above.birthDate) {
              if (above.birthDate.displayableProperty && above.birthDate.displayableProperty.value) {
                result.birthDate = above.birthDate.displayableProperty.value.plainText || '';
              }
              if (!result.birthDate && above.birthDate.dateComponents) {
                var dc = above.birthDate.dateComponents;
                result.birthDate = [dc.year, dc.month, dc.day].filter(Boolean).join('-');
              }
            }

            if (above.bio && above.bio.text && above.bio.text.plainText) {
              result.description = above.bio.text.plainText.substring(0, 300);
            }
          }

          var pushFilmography = function(title, year, role) {
            if (!title) {
              return;
            }
            result.filmography.push({
              title: title,
              year: year || '',
              role: role || ''
            });
          };

          var knownFor = main && main.knownForFeatureV2;
          if (knownFor && Array.isArray(knownFor.credits)) {
            for (var j = 0; j < knownFor.credits.length; j++) {
              var knownNode = knownFor.credits[j];
              if (!knownNode || !knownNode.title) {
                continue;
              }
              var knownRole = '';
              var knownRoleEdge = knownNode.creditedRoles && Array.isArray(knownNode.creditedRoles.edges)
                ? knownNode.creditedRoles.edges[0]
                : null;
              if (knownRoleEdge && knownRoleEdge.node) {
                knownRole = knownRoleEdge.node.text
                  || (knownRoleEdge.node.category ? knownRoleEdge.node.category.text || '' : '');
              }
              pushFilmography(
                knownNode.title.titleText ? knownNode.title.titleText.text : '',
                knownNode.title.releaseYear ? String(knownNode.title.releaseYear.year || '') : '',
                knownRole
              );
            }
          }

          if (result.filmography.length === 0) {
            var creditSources = [];
            if (main && main.released && Array.isArray(main.released.edges)) {
              creditSources.push(main.released.edges);
            }
            if (main && main.groupings && Array.isArray(main.groupings.edges)) {
              creditSources.push(main.groupings.edges);
            }

            for (var k = 0; k < creditSources.length && result.filmography.length < 30; k++) {
              var groups = creditSources[k];
              for (var m = 0; m < groups.length && result.filmography.length < 30; m++) {
                var groupNode = groups[m] && groups[m].node;
                if (!groupNode) {
                  continue;
                }

                var roleName = groupNode.grouping ? groupNode.grouping.text || '' : '';
                var credits = groupNode.credits && Array.isArray(groupNode.credits.edges)
                  ? groupNode.credits.edges
                  : [];
                for (var n = 0; n < credits.length && result.filmography.length < 30; n++) {
                  var creditNode = credits[n] && credits[n].node;
                  if (!creditNode || !creditNode.title) {
                    continue;
                  }
                  pushFilmography(
                    creditNode.title.titleText ? creditNode.title.titleText.text : (creditNode.title.originalTitleText ? creditNode.title.originalTitleText.text : ''),
                    creditNode.title.releaseYear ? String(creditNode.title.releaseYear.year || '') : '',
                    roleName
                  );
                }
              }
            }
          }
        } catch (error) {
          void error;
        }

        return result;
      })()
    `);
        if (!data || typeof data !== 'object' || !('name' in data) || !data.name) {
            throw new CommandExecutionError(`Person not found: ${id}`, 'Check the person ID and try again');
        }
        const result = data;
        if (result.nameId && result.nameId !== id) {
            throw new CommandExecutionError(`IMDb returned a different person payload: ${result.nameId}`, 'Retry the command; if it persists, the person parser may need updating');
        }
        const filmography = Array.isArray(result.filmography) ? result.filmography : [];
        // Override url with a clean canonical URL (no query params like ?language=en-US)
        result.url = `https://www.imdb.com/name/${id}/`;
        const rows = Object.entries(result)
            .filter(([field, value]) => field !== 'filmography' && field !== 'nameId' && value !== '' && value != null)
            .map(([field, value]) => ({ field, value: String(value) }));
        if (filmography.length > 0) {
            rows.push({ field: 'filmography', value: '' });
            for (const entry of filmography.slice(0, limit)) {
                const suffix = [entry.year ? `(${entry.year})` : '', entry.role ? `[${entry.role}]` : '']
                    .filter(Boolean)
                    .join(' ');
                rows.push({
                    field: String(entry.title || ''),
                    value: suffix,
                });
            }
        }
        return rows;
    },
});
