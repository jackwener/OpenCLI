/**
 * Product Hunt today's top launches — filtered from public Atom feed.
 *
 * Shows the most recently published day's products (Product Hunt runs on
 * Pacific Time; the feed date may differ from UTC local date by up to 1 day).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchFeed } from './utils.js';
cli({
    site: 'producthunt',
    name: 'today',
    access: 'read',
    description: "Today's Product Hunt launches (most recent day in feed)",
    domain: 'www.producthunt.com',
    strategy: Strategy.PUBLIC,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max results' },
    ],
    columns: ['rank', 'name', 'tagline', 'author', 'url'],
    func: async (args) => {
        const count = Math.min(Number(args.limit) || 20, 50);
        const posts = await fetchFeed();
        if (posts.length === 0)
            return [];
        // Use the latest date in the feed (Product Hunt is PST-based)
        const latestDate = posts.map(p => p.date).sort().reverse()[0];
        const todayPosts = posts.filter(p => p.date === latestDate);
        return todayPosts.slice(0, count).map((p, i) => ({
            rank: i + 1,
            name: p.name,
            tagline: p.tagline,
            author: p.author,
            url: p.url,
        }));
    },
});
