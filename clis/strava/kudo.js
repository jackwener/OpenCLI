import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeActivityId, requireExecute } from './utils.js';
// ── strava kudo (write) ─────────────────────────────────────────────────
//
// Gives kudos to an activity by clicking the ADP "Give kudos" button
// ([data-testid="give-kudos-btn"]) in the logged-in session, then confirms the
// kudos count went up. Guarded by --execute since it notifies the activity owner.
cli({
    site: 'strava',
    name: 'kudo',
    access: 'write',
    description: 'Give kudos to a Strava activity (requires --execute)',
    domain: 'www.strava.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'activity', type: 'str', positional: true, required: true, help: 'Activity ID or activity URL' },
        { name: 'execute', type: 'boolean', default: false, help: 'Actually give the kudos (otherwise refuses)' },
    ],
    columns: ['status', 'message', 'activity_id', 'kudos_count'],
    func: async (page, kwargs) => {
        requireExecute(kwargs, 'kudo this activity');
        const id = normalizeActivityId(kwargs.activity);
        if (!id)
            throw new EmptyResultError('strava kudo', `Could not parse an activity id from "${kwargs.activity}".`);
        await page.goto(`https://www.strava.com/activities/${id}`);
        await page.wait(3);
        const before = await page.evaluate(`(() => {
      if (location.pathname.startsWith('/login')) return { authError: true };
      const n = document.querySelector('[data-react-class="ADPKudosAndComments"]');
      if (!n) return null;
      try { const p = JSON.parse(n.getAttribute('data-react-props') || '{}'); return { canKudo: p.canKudo, kudosCount: p.kudosCount }; } catch (e) { return null; }
    })()`);
        if (before && before.authError)
            throw new AuthRequiredError('strava.com', 'Not logged into strava.com. Sign in via the bound Chrome tab, then retry.');
        if (!before)
            throw new EmptyResultError('strava kudo', 'Activity not found or page structure changed.');
        if (before.canKudo === false) {
            return [{ status: 'skipped', message: 'Already kudoed or this is your own activity', activity_id: id, kudos_count: before.kudosCount ?? 0 }];
        }
        const clicked = await page.evaluate(`(() => {
      const b = document.querySelector('[data-testid="give-kudos-btn"]');
      if (!b) return { ok: false, message: 'Give-kudos button not found' };
      b.click();
      return { ok: true };
    })()`);
        if (!clicked || !clicked.ok)
            return [{ status: 'failed', message: (clicked && clicked.message) || 'Could not click kudos', activity_id: id, kudos_count: before.kudosCount ?? 0 }];
        await page.wait(2);
        // data-react-props holds the initial SSR state and does NOT update after a client
        // click, so confirm via the live DOM: the "Give kudos" button is replaced once given,
        // and the visible kudos counter ([data-testid="adp-kudos_button"]) increments.
        const after = await page.evaluate(`(() => {
      const stillGiveBtn = !!document.querySelector('[data-testid="give-kudos-btn"]');
      const countEl = document.querySelector('[data-testid="adp-kudos_button"]');
      const visibleCount = countEl ? parseInt((countEl.textContent || '').replace(/[^0-9]/g, ''), 10) : null;
      return { stillGiveBtn, visibleCount: Number.isFinite(visibleCount) ? visibleCount : null };
    })()`);
        const ok = !after.stillGiveBtn || (after.visibleCount != null && after.visibleCount > (before.kudosCount ?? 0));
        const newCount = after.visibleCount != null ? after.visibleCount : (before.kudosCount ?? 0) + (ok ? 1 : 0);
        return [{
                status: ok ? 'success' : 'failed',
                message: ok ? 'Kudos given' : 'Kudos may not have registered',
                activity_id: id,
                kudos_count: newCount,
            }];
    },
});
