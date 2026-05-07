import { ArgumentError, AuthRequiredError, selectorError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

/**
 * Extract follower rows from Twitter/X follower-list SPA cells.
 *
 * Verified DOM shape on x.com followers list (confirmed live 2026-05-05):
 *   - `[data-testid="UserCell"]` per follower
 *     - `[data-testid="UserAvatar-Container-<handle>"]` — stable handle source
 *     - `[data-testid="<userId>-follow"]` — follow button (i18n-independent)
 *     - `[data-testid="userFollowIndicator"]` — "Follows you" badge when present
 *     - the bio (when present) is rendered into `cell.innerText` but has NO
 *       dedicated testid in the list view (`UserDescription` only appears on
 *       the standalone profile page, NOT inside follower-list cells).
 *
 * Strategy: subtract the i18n-variable button / badge texts from the lines of
 * `cell.innerText`, treat the first remaining `@…` line as the handle, the
 * first non-handle line as display name, and the rest as bio. We avoid
 * locale-coupled string matching (`"Follow"` / `"关注"` / `"Folgen"`).
 *
 * Note: Twitter does NOT render follower COUNTS in the list view, so the
 * `followers` column is omitted from the output schema. Use
 * `opencli twitter profile <user>` to read a per-user follower count.
 */
async function extractFollowersFromDOM(page) {
    const script = `() => {
        const cells = document.querySelectorAll('[data-testid="UserCell"]');
        const out = [];
        for (const cell of cells) {
            // Collect i18n-variable UI strings to strip from the cell text.
            const stripTexts = new Set();
            const buttons = cell.querySelectorAll(
                '[data-testid$="-follow"],[data-testid$="-unfollow"],[data-testid="userFollowIndicator"]'
            );
            for (const el of buttons) {
                const t = (el.innerText || '').trim();
                if (t) stripTexts.add(t);
            }
            const lines = (cell.innerText || '')
                .split('\\n')
                .map(s => s.trim())
                .filter(Boolean)
                .filter(l => !stripTexts.has(l));
            // Pull the @handle line; fall back to UserAvatar-Container-<handle>.
            let screen_name = '';
            const remaining = [];
            for (const l of lines) {
                if (!screen_name && l.startsWith('@')) {
                    screen_name = l.slice(1).split(/\\s/)[0];
                } else {
                    remaining.push(l);
                }
            }
            if (!screen_name) {
                const av = cell.querySelector('[data-testid^="UserAvatar-Container-"]');
                const tid = av ? av.getAttribute('data-testid') || '' : '';
                if (tid.startsWith('UserAvatar-Container-')) {
                    screen_name = tid.slice('UserAvatar-Container-'.length);
                }
            }
            // First non-handle line is display name (may equal handle when the user hasn't set one).
            const name = remaining[0] || screen_name;
            // Lines past the display name form the bio.
            const bio = remaining.slice(1).join(' ').replace(/\\s+/g, ' ').trim();
            if (screen_name) {
                out.push({ screen_name, name, bio });
            }
        }
        return out;
    }`;
    return page.evaluate(script);
}

function normalizeScreenName(value) {
    return String(value ?? '').trim().replace(/^\/+/, '').replace(/^@+/, '');
}

cli({
    site: 'twitter',
    name: 'followers',
    access: 'read',
    description: 'Get accounts following a Twitter/X user',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        {
            name: 'user',
            positional: true,
            type: 'string',
            required: false,
            help: 'Twitter/X handle (with or without @). Omit to fetch followers of the currently logged-in account.',
        },
        { name: 'limit', type: 'int', default: 50 },
    ],
    // `followers` (count) is NOT exposed: the SPA followers-list view does not
    // render it. Use `twitter profile <user>` for per-user follower counts.
    columns: ['screen_name', 'name', 'bio'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit;
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('limit must be a positive integer');
        }

        let targetUser = normalizeScreenName(kwargs.user);
        if (!targetUser) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = await page.evaluate(`() => {
                const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
                return link ? link.getAttribute('href') : null;
            }`);
            if (!href) {
                throw new AuthRequiredError('x.com', 'Could not find logged-in user profile link. Are you logged in?');
            }
            targetUser = normalizeScreenName(href);
        }
        if (!targetUser) {
            throw new ArgumentError('twitter followers user cannot be empty', 'Example: opencli twitter followers @elonmusk --limit 100');
        }

        // 1. Navigate to profile page
        await page.goto(`https://x.com/${targetUser}`);
        await page.wait(3);

        // 2. Click the followers tab via SPA navigation (preserves session/state).
        //    Twitter sometimes only renders /verified_followers on profiles with
        //    badge filtering enabled; try the canonical link first, fall back.
        const safeUser = JSON.stringify(targetUser);
        const clicked = await page.evaluate(`() => {
            const target = ${safeUser};
            const selectors = [
                'a[href="/' + target + '/followers"]',
                'a[href="/' + target + '/verified_followers"]',
            ];
            for (const sel of selectors) {
                const link = document.querySelector(sel);
                if (link) { link.click(); return true; }
            }
            return false;
        }`);
        if (!clicked) {
            throw selectorError('Twitter followers link', 'Twitter may have changed the layout.');
        }

        // 3. Wait for follower cells to appear
        await page.wait({ selector: '[data-testid="UserCell"]', timeout: 10000 });

        // 4. Extract from DOM, scroll to load more, dedupe by screen_name
        const allFollowers = [];
        const seen = new Set();
        let sameCount = 0;
        while (allFollowers.length < limit && sameCount < 3) {
            const followers = await extractFollowersFromDOM(page);
            const newFollowers = followers.filter(f => !seen.has(f.screen_name));
            for (const f of newFollowers) {
                seen.add(f.screen_name);
                allFollowers.push(f);
            }
            if (newFollowers.length === 0) {
                sameCount++;
            } else {
                sameCount = 0;
            }
            if (allFollowers.length >= limit) break;
            await page.autoScroll({ times: 1, delayMs: 500 });
            await page.wait(2);
        }
        if (allFollowers.length === 0) {
            throw new EmptyResultError('twitter followers', `No followers found for @${targetUser}`);
        }
        return allFollowers.slice(0, limit);
    }
});
