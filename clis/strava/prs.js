import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, parseActivityId, normalizeAthleteId } from './utils.js';
// ── strava prs (read) ───────────────────────────────────────────────────
//
// An athlete profile lists personal records / best efforts as a table of
// label → value rows, where the value links to /activities/<id>/best-efforts.
// We pair each best-effort link with its row label.
cli({
    site: 'strava',
    name: 'prs',
    access: 'read',
    description: "An athlete's personal records / best efforts",
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'athlete', type: 'str', positional: true, required: true, help: 'Athlete ID or profile URL' },
        { name: 'limit', type: 'int', default: 30, help: 'Number of records' },
    ],
    columns: ['rank', 'label', 'value', 'activity_id', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 30;
        const id = normalizeAthleteId(kwargs.athlete);
        if (!id)
            throw new EmptyResultError('strava prs', `Could not parse an athlete id from "${kwargs.athlete}".`);
        await page.goto(`https://www.strava.com/athletes/${id}`);
        await page.wait(2);
        const raw = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      return [...document.querySelectorAll('a[href*="/best-efforts"]')].map((a) => {
        const value = a.textContent.replace(/\\s+/g, ' ').trim();
        // Label is the nearest preceding cell/sibling in the same row.
        const row = a.closest('tr') || a.parentElement;
        let label = '';
        if (row) {
          const cells = [...row.querySelectorAll('td, th')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim());
          label = cells.find((c) => c && c !== value) || '';
          if (!label) {
            const prev = a.parentElement && a.parentElement.previousElementSibling;
            label = prev ? prev.textContent.replace(/\\s+/g, ' ').trim() : '';
          }
        }
        return { label, value, href: a.getAttribute('href') };
      }).filter((x) => x.value);
    })()`);
        if (raw && raw.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!Array.isArray(raw) || raw.length === 0)
            throw new EmptyResultError('strava prs', 'No personal records / best efforts found for this athlete.');
        const seen = new Set();
        const rows = [];
        for (const item of raw) {
            const activityId = parseActivityId(item.href);
            const key = `${item.label}|${item.value}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            rows.push({
                rank: rows.length + 1,
                label: cleanText(item.label, 40),
                value: cleanText(item.value, 40),
                activity_id: activityId || '',
                url: activityId ? `https://www.strava.com/activities/${activityId}` : '',
            });
            if (rows.length >= limit)
                break;
        }
        return rows;
    },
});
