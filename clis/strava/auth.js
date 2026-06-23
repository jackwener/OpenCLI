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
    const base = await page.evaluate(`(() => {
    if (location.pathname.startsWith('/login')) return { authError: true };
    let id = '';
    const current = (typeof window !== 'undefined' && window.currentAthlete) || null;
    if (current && current.id) id = String(current.id);
    if (!id) {
      const link = [...document.querySelectorAll('a[href*="/athletes/"]')]
        .map((a) => (a.getAttribute('href') || '').match(/\\/athletes\\/(\\d+)(?:$|[/?])/))
        .find(Boolean);
      if (link) id = link[1];
    }
    return { id };
  })()`);
    if (!base || base.authError || !base.id) {
        throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
    }
    // window.currentAthlete only carries the id, so read the full name off the profile h1.
    await page.goto(`https://www.strava.com/athletes/${base.id}`);
    await page.wait(1);
    const name = await page.evaluate(`(() => (document.querySelector('h1')?.textContent || '').replace(/\\s+/g, ' ').trim())()`);
    return {
        athlete_id: base.id,
        name: name || '',
        url: `https://www.strava.com/athletes/${base.id}`,
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
