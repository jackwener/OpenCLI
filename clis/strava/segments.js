import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, normalizeSegmentId } from './utils.js';
// ── strava segments ────────────────────────────────────────────────────
//
// /athlete/segments/starred renders the viewer's starred segments as a single
// server-rendered table — one row per segment with sport, name, distance,
// average grade / elevation and a link to /segments/<id>.
cli({
    site: 'strava',
    name: 'segments',
    access: 'read',
    description: 'Your starred Strava segments',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of segments' },
    ],
    columns: ['rank', 'type', 'name', 'distance', 'elevation', 'id', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        await page.goto('https://www.strava.com/athlete/segments/starred');
        await page.wait(2);
        const path = await page.evaluate('() => location.pathname');
        if (typeof path === 'string' && path.startsWith('/login'))
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        const raw = await page.evaluate(`(() => {
      const table = document.querySelector('table');
      if (!table) return [];
      return [...table.querySelectorAll('tbody tr')].map((tr) => {
        const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\\s+/g, ' ').trim());
        const link = tr.querySelector('a[href*="/segments/"]');
        const icon = tr.querySelector('.app-icon');
        return {
          // The segment name is the link text; the sport is a plain-text cell (no .app-icon here).
          name: link ? link.textContent.replace(/\\s+/g, ' ').trim() : '',
          iconType: icon ? icon.textContent.replace(/\\s+/g, ' ').trim() : '',
          cells,
          href: link ? link.getAttribute('href') : '',
        };
      }).filter((x) => x.href);
    })()`);
        if (!Array.isArray(raw) || raw.length === 0)
            throw new EmptyResultError('strava segments', 'No starred segments found. Star some segments on Strava, or the page structure changed.');
        const SPORTS = /^(ride|run|swim|hike|walk|e-?bike ?ride|trail run|nordic ?ski|alpine ?ski|snowboard|ice ?skate|inline ?skate|kayaking|canoeing|rowing|stand ?up ?paddling|surfing|wheelchair|handcycle|velomobile|virtual ?ride|virtual ?run)$/i;
        return raw.slice(0, limit).map((item, index) => {
            const id = normalizeSegmentId(item.href);
            // Distance carries a km/mi unit; elevation is the trailing m/ft cell.
            const distance = (item.cells.find((c) => /\d\s*(km|mi)\b/i.test(c)) || '');
            const elevation = (item.cells.filter((c) => /\d\s*(m|ft)\b/i.test(c) && !/\d\s*(km|mi)\b/i.test(c)).pop() || '');
            // Sport is either an .app-icon label or a short sport-word cell.
            const sportCell = item.cells.find((c) => SPORTS.test(c)) || '';
            return {
                rank: index + 1,
                type: (item.iconType || sportCell || '').toLowerCase(),
                name: cleanText(item.name, 80),
                distance,
                elevation,
                id,
                url: id ? `https://www.strava.com/segments/${id}` : '',
            };
        });
    },
});
