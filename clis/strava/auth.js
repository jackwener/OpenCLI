import { AuthRequiredError } from '@jackwener/opencli/errors';
import { registerSiteAuthCommands } from '../_shared/site-auth.js';
// ── strava whoami / login ───────────────────────────────────────────────
//
// Strava signs requests out by bouncing protected pages to /login. The logged-in
// athlete is exposed in-page as window.currentAthlete plus the nav profile link,
// so verify() reads identity straight off the dashboard.
async function verifyStravaIdentity(page) {
    await page.goto('https://www.strava.com/dashboard');
    await page.wait(2);
    const result = await page.evaluate(`(() => {
    if (location.pathname.startsWith('/login')) {
      return { authError: true };
    }
    const out = { id: '', name: '' };
    const current = (typeof window !== 'undefined' && window.currentAthlete) || null;
    if (current) {
      out.id = String(current.id || current.athleteId || '');
      out.name = (current.display_name || current.name || [current.firstname, current.lastname].filter(Boolean).join(' ') || '').trim();
    }
    if (!out.id) {
      const link = [...document.querySelectorAll('a[href*="/athletes/"]')]
        .map((a) => (a.getAttribute('href') || '').match(/\\/athletes\\/(\\d+)(?:$|[/?])/))
        .find(Boolean);
      if (link) out.id = link[1];
    }
    if (!out.name) {
      const avatar = document.querySelector('[data-react-class="AvatarWrapper"]');
      if (avatar) {
        try { out.name = (JSON.parse(avatar.getAttribute('data-react-props') || '{}').name || '').trim(); } catch (e) { /* ignore */ }
      }
    }
    return out;
  })()`);
    if (!result || result.authError || !result.id) {
        throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
    }
    return {
        athlete_id: result.id,
        name: result.name || '',
        url: `https://www.strava.com/athletes/${result.id}`,
    };
}
registerSiteAuthCommands({
    site: 'strava',
    domain: 'strava.com',
    loginUrl: 'https://www.strava.com/login',
    columns: ['athlete_id', 'name', 'url'],
    whoamiDescription: 'Show the currently logged-in Strava athlete',
    loginDescription: 'Log into Strava in the bound browser (run once)',
    verify: verifyStravaIdentity,
    poll: verifyStravaIdentity,
});
