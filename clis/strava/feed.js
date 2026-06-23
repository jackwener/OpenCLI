import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, parseActivityId } from './utils.js';
// ── strava feed ────────────────────────────────────────────────────────
//
// The dashboard ("following" feed) renders each item as a [data-testid="web-feed-entry"].
// The kudos/comment counts live deep inside a federated micro-frontend and aren't in the
// DOM attributes, but each entry reliably carries the activity link, the athlete link and
// the activity title — enough to surface the feed and hand activity ids to other commands.
cli({
    site: 'strava',
    name: 'feed',
    access: 'read',
    description: 'Your Strava dashboard (following) activity feed',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of feed entries' },
    ],
    columns: ['rank', 'athlete_id', 'activity_id', 'title', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        await page.goto('https://www.strava.com/dashboard');
        await page.wait(3);
        const path = await page.evaluate('() => location.pathname');
        if (typeof path === 'string' && path.startsWith('/login'))
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        const raw = await page.evaluate(`(() => {
      return [...document.querySelectorAll('[data-testid="web-feed-entry"]')].map((e) => {
        const act = e.querySelector('a[href*="/activities/"]');
        const ath = e.querySelector('a[href*="/athletes/"]');
        const titleEl = act || e.querySelector('[data-testid="entry-title"], h3');
        return {
          activityHref: act ? act.getAttribute('href') : '',
          athleteHref: ath ? ath.getAttribute('href') : '',
          title: titleEl ? titleEl.textContent.replace(/\\s+/g, ' ').trim() : '',
        };
      }).filter((x) => x.activityHref);
    })()`);
        if (!Array.isArray(raw) || raw.length === 0)
            throw new EmptyResultError('strava feed', 'No feed entries found. The dashboard may be empty or the page structure changed.');
        return raw.slice(0, limit).map((item, index) => {
            const activityId = parseActivityId(item.activityHref);
            const athleteId = (item.athleteHref || '').match(/\/athletes\/(\d+)/);
            return {
                rank: index + 1,
                athlete_id: athleteId ? athleteId[1] : '',
                activity_id: activityId || '',
                title: cleanText(item.title, 80),
                url: activityId ? `https://www.strava.com/activities/${activityId}` : '',
            };
        });
    },
});
