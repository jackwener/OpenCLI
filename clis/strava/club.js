import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { cleanText, normalizeClubId, parseActivityId, requireExecute } from './utils.js';
// ── strava club (read) ──────────────────────────────────────────────────
cli({
    site: 'strava',
    name: 'club',
    access: 'read',
    description: 'Strava club details (name, sport, location, members)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'club', type: 'str', positional: true, required: true, help: 'Club ID or club URL' },
    ],
    columns: ['id', 'name', 'sport', 'location', 'members', 'url'],
    func: async (page, kwargs) => {
        const id = normalizeClubId(kwargs.club);
        if (!id)
            throw new EmptyResultError('strava club', `Could not parse a club id from "${kwargs.club}".`);
        await page.goto(`https://www.strava.com/clubs/${id}`);
        await page.wait(2);
        const data = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const name = document.querySelector('h1')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      // document.title is "<location> Club | <name> on Strava".
      const title = document.title || '';
      const locFromTitle = (title.split(' Club |')[0] || '').trim();
      const bodyText = document.body.textContent.replace(/\\s+/g, ' ');
      const membersMatch = bodyText.match(/([\\d,]+)\\s+members?/i);
      const sportMatch = bodyText.match(/\\b(Cycling|Running|Triathlon|Swimming|Hiking|Walking|Skiing|Snowboarding|Trail Running|Mountain Biking|Multisport|General|Other)\\b/i);
      return { name, locFromTitle, sport: sportMatch ? sportMatch[1] : '', members: membersMatch ? membersMatch[1].replace(/,/g, '') : '' };
    })()`);
        if (data && data.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!data || !data.name)
            throw new EmptyResultError('strava club', 'Club not found or page structure changed.');
        return [{
                id,
                name: cleanText(data.name, 80),
                sport: data.sport || '',
                location: cleanText(data.locFromTitle, 80),
                members: data.members || '',
                url: `https://www.strava.com/clubs/${id}`,
            }];
    },
});
// ── strava club-activities (read) ───────────────────────────────────────
cli({
    site: 'strava',
    name: 'club-activities',
    access: 'read',
    description: 'Recent member activities in a Strava club',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'club', type: 'str', positional: true, required: true, help: 'Club ID or club URL' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of activities' },
    ],
    columns: ['rank', 'athlete', 'athlete_id', 'activity_id', 'title', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        const id = normalizeClubId(kwargs.club);
        if (!id)
            throw new EmptyResultError('strava club-activities', `Could not parse a club id from "${kwargs.club}".`);
        await page.goto(`https://www.strava.com/clubs/${id}/recent_activity`);
        await page.wait(3);
        const raw = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const entries = [...document.querySelectorAll('[data-testid="web-feed-entry"]')];
      const list = (entries.length ? entries : [document]).flatMap((e) => {
        const acts = [...e.querySelectorAll('a[href*="/activities/"]')];
        if (!acts.length) return [];
        const act = acts[0];
        const ath = e.querySelector ? e.querySelector('a[href*="/athletes/"]') : null;
        return [{
          activityHref: act.getAttribute('href'),
          athleteHref: ath ? ath.getAttribute('href') : '',
          athlete: ath ? ath.textContent.replace(/\\s+/g, ' ').trim() : '',
          title: act.textContent.replace(/\\s+/g, ' ').trim(),
        }];
      });
      return { list };
    })()`);
        if (raw && raw.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        const list = (raw && raw.list) || [];
        if (!list.length)
            throw new EmptyResultError('strava club-activities', 'No recent club activities found (or the page structure changed).');
        const seen = new Set();
        const rows = [];
        for (const item of list) {
            const activityId = parseActivityId(item.activityHref);
            if (!activityId || seen.has(activityId))
                continue;
            seen.add(activityId);
            const athleteId = (item.athleteHref || '').match(/\/athletes\/(\d+)/);
            rows.push({
                rank: rows.length + 1,
                athlete: cleanText(item.athlete, 60),
                athlete_id: athleteId ? athleteId[1] : '',
                activity_id: activityId,
                title: cleanText(item.title, 80),
                url: `https://www.strava.com/activities/${activityId}`,
            });
            if (rows.length >= limit)
                break;
        }
        return rows;
    },
});
// ── strava join (write) ─────────────────────────────────────────────────
//
// Joins a club by clicking its primary "Join" CTA in the logged-in session,
// then confirms the page now offers "Leave". Guarded by --execute.
cli({
    site: 'strava',
    name: 'join',
    access: 'write',
    description: 'Join a Strava club (requires --execute)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'club', type: 'str', positional: true, required: true, help: 'Club ID or club URL' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually join the club (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'club_id'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'join this club');
        const id = normalizeClubId(kwargs.club);
        if (!id)
            throw new EmptyResultError('strava join', `Could not parse a club id from "${kwargs.club}".`);
        await page.goto(`https://www.strava.com/clubs/${id}`);
        await page.wait(2);
        const state = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const txt = document.body.textContent;
      const alreadyMember = /\\bLeave\\b/.test(txt) && !/\\bJoin\\b/.test(txt);
      // The join CTA is a button or link whose visible text is exactly "Join" / "Join Club".
      const cands = [...document.querySelectorAll('button, a, [role="button"]')];
      const joinEl = cands.find((el) => /^(join|join club)$/i.test((el.textContent || '').replace(/\\s+/g, ' ').trim()));
      if (alreadyMember && !joinEl) return { already: true };
      if (!joinEl) return { ok: false, message: 'Join button not found (club may be invite-only)' };
      joinEl.click();
      return { ok: true };
    })()`);
        if (state && state.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (state && state.already)
            return [{ status: 'skipped', message: 'Already a member of this club', club_id: id }];
        if (!state || !state.ok)
            return [{ status: 'failed', message: (state && state.message) || 'Could not click Join', club_id: id }];
        await page.wait(2);
        const after = await page.evaluate(`(() => {
      const txt = document.body.textContent;
      return { leave: /\\bLeave\\b/.test(txt), pending: /\\b(Pending|Requested)\\b/.test(txt) };
    })()`);
        const ok = after && (after.leave || after.pending);
        return [{
                status: ok ? 'success' : 'failed',
                message: after && after.pending ? 'Join requested (pending approval)' : ok ? 'Joined club' : 'Join may not have registered',
                club_id: id,
            }];
    },
});
