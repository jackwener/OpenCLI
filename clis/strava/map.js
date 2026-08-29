import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeActivityId } from './utils.js';
// ── strava map (read) ───────────────────────────────────────────────────
//
// The activity map is a canvas with no polyline exposed in the DOM, but the page
// offers route downloads (Export GPX / Export Original). This command returns the
// route-export URLs so the GPS track can be fetched, plus whether export is offered
// for the viewer (Strava only shows it to the owner / on exportable activities).
cli({
    site: 'strava',
    name: 'map',
    access: 'read',
    description: 'Route / map resources (GPX export URLs) for a Strava activity',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
    ],
    columns: ['activity_id', 'has_map', 'gpx_url', 'original_url', 'exportable', 'url'],
    func: async (page, kwargs) => {
        const id = normalizeActivityId(kwargs.activity);
        if (!id)
            throw new EmptyResultError('strava map', `Could not parse an activity id from "${kwargs.activity}".`);
        const url = `https://www.strava.com/activities/${id}`;
        await page.goto(url);
        await page.wait(2);
        const data = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      return {
        hasMap: !!document.querySelector('canvas, [class*="map" i]'),
        gpx: !!document.querySelector('a[href*="export_gpx"]'),
        original: !!document.querySelector('a[href*="export_original"]'),
      };
    })()`);
        if (data && data.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!data)
            throw new EmptyResultError('strava map', 'Activity not found or page structure changed.');
        return [{
                activity_id: id,
                has_map: data.hasMap === true,
                gpx_url: `${url}/export_gpx`,
                original_url: `${url}/export_original`,
                exportable: data.gpx === true,
                url,
            }];
    },
});
