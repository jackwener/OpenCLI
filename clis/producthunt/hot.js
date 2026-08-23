/**
 * Product Hunt top posts with vote counts.
 *
 * Strategy: UI (DOM/hydration state) — reads the Apollo store the homepage
 * hydrates itself from.
 * Contract: visible-ui. Evidence (2026-08-23): `window.__APOLLO_CLIENT__.cache
 * .extract()` on https://www.producthunt.com/ holds 36 `Post` entities with
 * `dailyRank` / `latestScore` / `commentsCount` / `featuredAt`.
 *
 * Why not INTERCEPT (the previous implementation): the homepage is server
 * rendered, so the leaderboard data never crosses the wire as an XHR after
 * navigation. `installInterceptor('producthunt.com')` + `waitForCapture(5)`
 * therefore timed out with "No network capture within 5s" on every run —
 * before the (working) DOM scrape below was ever reached.
 *
 * Why not PUBLIC_API: producthunt.com serves a Cloudflare managed challenge to
 * plain HTTP clients (403 + cf-mitigated: challenge), and the official GraphQL
 * API v2 needs a developer token.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { APOLLO_POSTS_EVAL } from './utils.js';
cli({
    site: 'producthunt',
    name: 'hot',
    access: 'read',
    description: "Today's top Product Hunt launches with vote counts",
    domain: 'www.producthunt.com',
    strategy: Strategy.UI,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
    ],
    columns: ['rank', 'name', 'votes', 'url'],
    func: async (page, args) => {
        const count = Math.min(Number(args.limit) || 20, 50);
        await page.goto('https://www.producthunt.com');
        await page.wait({ selector: 'a[href^="/products/"]', timeout: 20000 }).catch(() => { });
        const posts = await page.evaluate(APOLLO_POSTS_EVAL);
        if (!Array.isArray(posts)) {
            throw new CliError('PAGE_CHANGED', 'Product Hunt no longer exposes window.__APOLLO_CLIENT__', 'The homepage data store moved; re-inspect the page and update APOLLO_POSTS_EVAL');
        }
        // The homepage mixes today's feed with "top of last week/month" rails,
        // so every card can legitimately carry dailyRank "1". Rank here is list
        // position by vote count — same contract as before this fix. For a real
        // per-day leaderboard rank use `producthunt today`.
        const ranked = posts
            .filter((p) => Number(p.votes) > 0)
            .sort((a, b) => Number(b.votes) - Number(a.votes));
        if (ranked.length === 0) {
            throw new CliError('EMPTY_RESULT', 'Could not retrieve Product Hunt vote counts', 'Open https://www.producthunt.com in a normal tab — a challenge page returns an empty store');
        }
        return ranked.slice(0, count).map((p, i) => ({
            rank: i + 1,
            name: p.name,
            votes: Number(p.votes) || 0,
            url: p.url,
        }));
    },
});
