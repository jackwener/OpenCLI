/**
 * Product Hunt daily leaderboard — one specific launch day, ranked.
 *
 * Strategy: UI (DOM/hydration state). Contract: visible-ui.
 * Evidence (2026-08-23): https://www.producthunt.com/leaderboard/daily/2026/8/23
 * hydrates `window.__APOLLO_CLIENT__` with `Post` entities carrying
 * `dailyRank` / `latestScore` / `commentsCount` / `featuredAt`.
 *
 * Why this stopped using the Atom feed: https://www.producthunt.com/feed is
 * ordered by <updated>, not <published>, and mixes launches from several weeks
 * (measured 2026-08-23: 50 entries spanning 17 distinct launch dates, with only
 * ONE entry on the most recent date). The old "take the newest <published>
 * date" heuristic therefore returned a single unranked product almost every
 * day. The feed also carries no rank and no vote count at all — see
 * `producthunt posts` for what it can honestly answer.
 *
 * Columns changed with this fix: `author` (feed-only field, absent from the
 * leaderboard store) was replaced by `votes`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { APOLLO_POSTS_EVAL, rankApolloPosts, producthuntToday } from './utils.js';
cli({
    site: 'producthunt',
    name: 'today',
    access: 'read',
    description: "Product Hunt daily leaderboard (rank + votes) for a given day",
    domain: 'www.producthunt.com',
    strategy: Strategy.UI,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max results' },
        { name: 'date', type: 'string', default: '', help: 'Launch day as YYYY-MM-DD (default: today in US/Pacific)' },
    ],
    columns: ['rank', 'name', 'tagline', 'votes', 'url'],
    func: async (page, args) => {
        const count = Math.min(Number(args.limit) || 20, 50);
        const date = String(args.date ?? '').trim() || producthuntToday();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            throw new CliError('INVALID_ARGUMENT', `Invalid --date "${date}"`, 'Use YYYY-MM-DD');
        }
        const [y, m, d] = date.split('-').map(Number);
        await page.goto(`https://www.producthunt.com/leaderboard/daily/${y}/${m}/${d}`);
        await page.wait({ selector: 'a[href^="/products/"]', timeout: 20000 }).catch(() => { });
        const posts = await page.evaluate(APOLLO_POSTS_EVAL);
        if (!Array.isArray(posts)) {
            throw new CliError('PAGE_CHANGED', 'Product Hunt no longer exposes window.__APOLLO_CLIENT__', 'The leaderboard data store moved; re-inspect the page and update APOLLO_POSTS_EVAL');
        }
        // The page also hydrates sidebar/related posts from other days — keep
        // only the ones actually featured on the requested day.
        const sameDay = posts.filter((p) => String(p.featuredAt || '').slice(0, 10) === date);
        const ranked = rankApolloPosts(sameDay.length ? sameDay : posts.filter((p) => Number(p.dailyRank) > 0));
        if (ranked.length === 0) {
            throw new CliError('EMPTY_RESULT', `No Product Hunt launches found for ${date}`, 'Future dates and pre-2014 dates are empty; otherwise open the leaderboard in a normal tab to check for a challenge page');
        }
        return ranked.slice(0, count).map((p, i) => ({
            rank: Number(p.dailyRank) || i + 1,
            name: p.name,
            tagline: String(p.tagline || '').slice(0, 120),
            votes: Number(p.votes) || 0,
            url: p.url,
        }));
    },
});
