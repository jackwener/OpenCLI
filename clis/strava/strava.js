import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, normalizeActivityId, normalizeAthleteId, parseActivityId, parseInlineStats, parseMoreStats, pickFollowCount, sportFromIcon, } from './utils.js';
// ── CLI definition ────────────────────────────────────────────────────
//
// Strava serves authenticated athlete/activity pages as server-rendered HTML —
// `opencli browser analyze` classifies it as Pattern C (no JSON XHR, no SSR state),
// so this adapter scrapes the rendered DOM through the logged-in Chrome session
// (Strategy.COOKIE). The session cookie is HttpOnly, so login is verified by
// detecting the redirect to /login that Strava issues for signed-out requests.
const BASE = 'https://www.strava.com';
// Strava bounces signed-out requests for athlete/activity pages to /login.
async function ensureLoggedIn(page) {
    const path = await page.evaluate('() => location.pathname');
    if (typeof path === 'string' && path.startsWith('/login')) {
        throw new AuthRequiredError('strava.com', 'Not logged into strava.com (redirected to /login). Sign in via the bound Chrome tab, then retry.');
    }
}
// ── strava profile ─────────────────────────────────────────────────────
cli({
    site: 'strava',
    name: 'profile',
    access: 'read',
    description: 'Strava athlete profile (name, location, follower counts)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete ID or profile URL' },
    ],
    columns: ['id', 'name', 'location', 'following', 'followers', 'url'],
    func: async (page, kwargs) => {
        const id = normalizeAthleteId(kwargs.athlete);
        if (!id)
            throw new EmptyResultError('strava profile', `Could not parse an athlete id from "${kwargs.athlete}".`);
        await page.goto(`${BASE}/athletes/${id}`);
        await page.wait(2);
        await ensureLoggedIn(page);
        const data = await page.evaluate(`(() => {
      const links = [...document.querySelectorAll('a[href*="follows?type="]')].map((a) => ({
        href: a.getAttribute('href') || '',
        text: a.textContent.replace(/\\s+/g, ' ').trim(),
      }));
      return {
        name: document.querySelector('h1')?.textContent?.trim() || '',
        location: document.querySelector('.location')?.textContent?.trim() || '',
        followLinks: links,
      };
    })()`);
        if (!data || !data.name) {
            throw new EmptyResultError('strava profile', 'No athlete profile found. The athlete may be private or the page structure changed.');
        }
        return [{
                id,
                name: cleanText(data.name, 80),
                location: cleanText(data.location, 80),
                following: pickFollowCount(data.followLinks, 'following'),
                followers: pickFollowCount(data.followLinks, 'followers'),
                url: `${BASE}/athletes/${id}`,
            }];
    },
});
// ── strava activities ──────────────────────────────────────────────────
cli({
    site: 'strava',
    name: 'activities',
    access: 'read',
    description: 'Recent activities on a Strava athlete profile',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete ID or profile URL' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of activities' },
    ],
    columns: ['rank', 'type', 'name', 'id', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 10;
        const id = normalizeAthleteId(kwargs.athlete);
        if (!id)
            throw new EmptyResultError('strava activities', `Could not parse an athlete id from "${kwargs.athlete}".`);
        await page.goto(`${BASE}/athletes/${id}?num_entries=${limit}`);
        await page.wait(2);
        await ensureLoggedIn(page);
        const raw = await page.evaluate(`(() => {
      const ul = document.querySelector('ul.recent-activities');
      if (!ul) return [];
      return [...ul.querySelectorAll('li')].map((li) => {
        const icon = li.querySelector('.app-icon');
        const a = li.querySelector('a.minimal, a[href*="/activities/"]');
        return {
          iconClass: icon ? [...icon.classList].find((c) => c.startsWith('icon-') && !['icon-dark', 'icon-light', 'icon-sm', 'icon-md', 'icon-lg'].includes(c)) || '' : '',
          typeText: icon ? icon.textContent.replace(/\\s+/g, ' ').trim() : '',
          name: a ? a.textContent.replace(/\\s+/g, ' ').trim() : '',
          href: a ? a.getAttribute('href') : '',
        };
      }).filter((x) => x.href);
    })()`);
        if (!Array.isArray(raw) || raw.length === 0) {
            throw new EmptyResultError('strava activities', 'No recent activities found. The athlete may have no public activities or the page structure changed.');
        }
        return raw.slice(0, limit).map((item, index) => {
            const activityId = parseActivityId(item.href);
            return {
                rank: index + 1,
                type: sportFromIcon(item.iconClass, item.typeText),
                name: cleanText(item.name, 80),
                id: activityId || '',
                url: activityId ? `${BASE}/activities/${activityId}` : '',
            };
        });
    },
});
// ── strava activity ────────────────────────────────────────────────────
cli({
    site: 'strava',
    name: 'activity',
    access: 'read',
    description: 'Single Strava activity detail (distance, time, speed, HR, power, cadence, calories)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'id', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
    ],
    columns: [
        'id', 'name', 'type', 'date',
        'distance', 'moving_time', 'elapsed_time', 'elevation',
        'avg_speed', 'max_speed', 'avg_pace', 'max_pace',
        'avg_hr', 'max_hr', 'avg_cadence', 'max_cadence',
        'avg_power', 'max_power', 'weighted_avg_power', 'total_work',
        'calories', 'temperature', 'device', 'gear', 'url',
    ],
    func: async (page, kwargs) => {
        const id = normalizeActivityId(kwargs.id);
        if (!id)
            throw new EmptyResultError('strava activity', `Could not parse an activity id from "${kwargs.id}".`);
        const url = `${BASE}/activities/${id}`;
        await page.goto(url);
        await page.wait(2);
        await ensureLoggedIn(page);
        const data = await page.evaluate(`(() => {
      const clean = (el) => el ? el.textContent.replace(/\\s+/g, ' ').trim() : '';
      // Both inline-stats blocks: the primary (distance/time/elevation) and the
      // ride-only "secondary-stats" (weighted avg power / total work).
      const stats = [...document.querySelectorAll('ul.inline-stats li')].map((li) => ({
        strong: clean(li.querySelector('strong')),
        full: clean(li),
      }));
      // The "More Stats" table: <th>label</th><td>avg</td><td>max</td>, identified
      // by its Avg/Max header so we never grab some other unstyled table.
      const table = [...document.querySelectorAll('table.unstyled')]
        .find((t) => /Avg/.test(clean(t.querySelector('thead'))));
      const moreStats = table ? [...table.querySelectorAll('tbody tr')].map((tr) => {
        const tds = [...tr.querySelectorAll('td')];
        return { label: clean(tr.querySelector('th')), avg: clean(tds[0]), max: clean(tds[1]) };
      }).filter((r) => r.label && r.avg) : [];
      const time = document.querySelector('time');
      return {
        title: document.title || '',
        name: document.querySelector('.activity-name')?.textContent?.trim() || '',
        stats,
        moreStats,
        device: clean(document.querySelector('.device')),
        gear: clean(document.querySelector('.gear-name')),
        date: time ? clean(time) : '',
      };
    })()`);
        if (!data || !Array.isArray(data.stats) || data.stats.length === 0) {
            throw new EmptyResultError('strava activity', 'No activity stats found. The activity may be private or the page structure changed.');
        }
        // document.title is "<name> | <Type> | Strava"; use it as a stable source for name + sport.
        const titleParts = (data.title || '').split('|').map((part) => part.trim());
        const name = data.name || titleParts[0] || '';
        const type = (titleParts[1] || '').toLowerCase();
        const inline = parseInlineStats(data.stats);
        const more = parseMoreStats(data.moreStats);
        return [{
                id,
                name: cleanText(name, 80),
                type,
                date: cleanText(data.date, 60),
                distance: inline.distance || '',
                moving_time: inline.moving_time || '',
                elapsed_time: more.elapsed_time || inline.elapsed_time || '',
                elevation: inline.elevation || '',
                avg_speed: more.avg_speed || inline.speed || '',
                max_speed: more.max_speed || '',
                avg_pace: more.avg_pace || inline.pace || '',
                max_pace: more.max_pace || '',
                avg_hr: more.avg_hr || '',
                max_hr: more.max_hr || '',
                avg_cadence: more.avg_cadence || '',
                max_cadence: more.max_cadence || '',
                avg_power: more.avg_power || '',
                max_power: more.max_power || '',
                weighted_avg_power: inline.weighted_avg_power || '',
                total_work: inline.total_work || '',
                calories: more.calories || inline.calories || '',
                temperature: more.temperature || '',
                device: cleanText(data.device, 60),
                // Strava renders a lone em/en dash when no gear is assigned — treat as empty.
                gear: /^[—–-]?$/.test(cleanText(data.gear)) ? '' : cleanText(data.gear, 60),
                url,
            }];
    },
});
