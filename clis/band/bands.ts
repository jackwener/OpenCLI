import { AuthRequiredError, EmptyResultError } from '../../src/errors.js';
import { cli, Strategy } from '../../src/registry.js';

/**
 * band bands — List all Bands you belong to.
 *
 * Band.us renders the full band list in the left sidebar of the home page for
 * logged-in users, so we can extract everything we need from the DOM without
 * XHR interception or any secondary navigation.
 *
 * Each sidebar item is an <a href="/band/{band_no}/..."> link whose text and
 * data attributes carry the band name and member count.
 */
cli({
  site: 'band',
  name: 'bands',
  description: 'List all Bands you belong to',
  domain: 'www.band.us',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [],
  columns: ['band_no', 'name', 'members'],

  func: async (page, _kwargs) => {
    const cookies = await page.getCookies({ domain: 'band.us' });
    const isLoggedIn = cookies.some(c => c.name === 'band_session');
    if (!isLoggedIn) throw new AuthRequiredError('band.us', 'Not logged in to Band');

    // Extract the band list from the sidebar. Poll until at least one band card
    // appears (React hydration may take a moment after navigation).
    // Sidebar band cards use class "bandCover _link" with hrefs like /band/{id}/post.
    const bands: { band_no: number; name: string; members: number }[] = await page.evaluate(`
      (async () => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));

        // Wait up to 9 s for sidebar band cards to render.
        for (let i = 0; i < 30; i++) {
          if (document.querySelector('a.bandCover._link')) break;
          await sleep(300);
        }

        const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
        const seen = new Set();
        const results = [];

        for (const a of Array.from(document.querySelectorAll('a.bandCover._link'))) {
          // Extract band_no from href: /band/{id} or /band/{id}/post only.
          const m = (a.getAttribute('href') || '').match(/^\\/band\\/(\\d+)(?:\\/post)?\\/?$/);
          if (!m) continue;
          const bandNo = Number(m[1]);
          if (seen.has(bandNo)) continue;
          seen.add(bandNo);

          // Band name lives in p.uriText inside div.bandName.
          const nameEl = a.querySelector('p.uriText');
          const name = nameEl ? norm(nameEl.textContent) : '';
          if (!name) continue;

          // Member count is the <em> inside span.member.
          const memberEl = a.querySelector('span.member em');
          const members = memberEl ? parseInt((memberEl.textContent || '').replace(/[^0-9]/g, ''), 10) || 0 : 0;

          results.push({ band_no: bandNo, name, members });
        }

        return results;
      })()
    `);

    if (!bands || bands.length === 0) {
      throw new EmptyResultError('band bands', 'No bands found in sidebar — are you logged in?');
    }

    return bands;
  },
});
