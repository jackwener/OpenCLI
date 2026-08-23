/**
 * Product Hunt latest posts — public Atom feed, no browser needed.
 *
 * Strategy: PUBLIC_API. Contract: stable (Atom feed, 200 without auth).
 *
 * Known shape of the source: the feed is ordered by <updated>, so an old launch
 * that just got a comment sits at the top. `parseFeed` re-sorts by launch date
 * so "latest" is true. The feed carries NO rank and NO vote count — `rank` here
 * is list position only. For real rank/votes use `producthunt today` or
 * `producthunt hot`.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchFeed, PRODUCTHUNT_CATEGORY_SLUGS } from './utils.js';
cli({
    site: 'producthunt',
    name: 'posts',
    access: 'read',
    description: 'Latest Product Hunt launches by launch date, no votes/rank (optional category filter)',
    domain: 'www.producthunt.com',
    strategy: Strategy.PUBLIC,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
        {
            name: 'category',
            type: 'string',
            default: '',
            help: `Category filter: ${PRODUCTHUNT_CATEGORY_SLUGS.join(', ')}`,
        },
    ],
    columns: ['rank', 'name', 'tagline', 'author', 'date', 'url'],
    func: async (args) => {
        const count = Math.min(Number(args.limit) || 20, 50);
        const category = String(args.category ?? '').trim() || undefined;
        const posts = await fetchFeed(category);
        return posts.slice(0, count);
    },
});
