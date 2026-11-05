import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, normalizeAthleteId, normalizeClubId } from './utils.js';
// ── strava clubs ───────────────────────────────────────────────────────
//
// An athlete profile lists the clubs they belong to as a row of club-logo links
// (/clubs/<id>); the club name rides on the logo's img alt text.
cli({
    site: 'strava',
    name: 'clubs',
    access: 'read',
    description: 'Clubs an athlete belongs to',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete ID or profile URL' },
        { name: 'limit', type: 'int', default: 30, help: 'Number of clubs' },
    ],
    columns: ['rank', 'id', 'name', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        const athleteId = normalizeAthleteId(kwargs.athlete);
        if (!athleteId)
            throw new EmptyResultError('strava clubs', `Could not parse an athlete id from "${kwargs.athlete}".`);
        await page.goto(`https://www.strava.com/athletes/${athleteId}`);
        await page.wait(2);
        const path = await page.evaluate('() => location.pathname');
        if (typeof path === 'string' && path.startsWith('/login'))
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        const raw = await page.evaluate(`(() => {
      const seen = new Set();
      const out = [];
      for (const a of document.querySelectorAll('a[href*="/clubs/"]')) {
        const href = a.getAttribute('href') || '';
        const m = href.match(/\\/clubs\\/(\\d+)/);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        const img = a.querySelector('img');
        const name = (img && (img.getAttribute('alt') || img.getAttribute('title'))) || a.textContent.replace(/\\s+/g, ' ').trim();
        out.push({ id: m[1], name: name || '' });
      }
      return out;
    })()`);
        if (!Array.isArray(raw) || raw.length === 0)
            throw new EmptyResultError('strava clubs', 'No clubs found. This athlete may not be in any clubs, or the page structure changed.');
        return raw.slice(0, limit).map((item, index) => ({
            rank: index + 1,
            id: normalizeClubId(item.id),
            name: cleanText(item.name, 80),
            url: `https://www.strava.com/clubs/${item.id}`,
        }));
    },
});
