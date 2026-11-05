import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeActivityId } from './utils.js';
// ── strava kudos ───────────────────────────────────────────────────────
//
// The activity page mounts a React component <ADPKudosAndComments> whose
// data-react-props carries the kudos/comment counts, whether the viewer may
// give kudos, and the owner — a stable structured source that survives the
// page's otherwise opaque (federated micro-frontend) markup.
cli({
    site: 'strava',
    name: 'kudos',
    access: 'read',
    description: 'Kudos and comment counts for a Strava activity',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
    ],
    columns: ['activity_id', 'kudos_count', 'comments_count', 'can_kudo', 'owner', 'owner_athlete_id'],
    func: async (page, kwargs) => {
        const id = normalizeActivityId(kwargs.activity);
        if (!id)
            throw new EmptyResultError('strava kudos', `Could not parse an activity id from "${kwargs.activity}".`);
        await page.goto(`https://www.strava.com/activities/${id}`);
        await page.wait(2);
        const data = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const node = document.querySelector('[data-react-class="ADPKudosAndComments"]');
      if (!node) return null;
      try {
        const p = JSON.parse(node.getAttribute('data-react-props') || '{}');
        return {
          kudosCount: p.kudosCount,
          commentsCount: p.commentsCount,
          canKudo: p.canKudo,
          ownerName: p.ownerName,
          ownerAthleteId: p.ownerAthleteId,
        };
      } catch (e) { return null; }
    })()`);
        if (data && data.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!data)
            throw new EmptyResultError('strava kudos', 'No kudos data found. The activity may be private or the page structure changed.');
        return [{
                activity_id: id,
                kudos_count: data.kudosCount ?? 0,
                comments_count: data.commentsCount ?? 0,
                can_kudo: data.canKudo === true,
                owner: data.ownerName || '',
                owner_athlete_id: data.ownerAthleteId ? String(data.ownerAthleteId) : '',
            }];
    },
});
