import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchRedditListing } from './api.js';
cli({
    site: 'reddit',
    name: 'user-comments',
    access: 'read',
    description: `View a Reddit user's comment history`,
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Reddit username (no `u/` prefix needed)' },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['subreddit', 'score', 'body', 'url'],
    func: async (page, kwargs) => {
        await page.goto('https://www.reddit.com');
        const username = String(kwargs.username ?? '');
        const name = username.startsWith('u/') ? username.slice(2) : username;
        const limit = kwargs.limit ?? 15;
        const children = await fetchRedditListing(page, '/user/' + encodeURIComponent(name) + '/comments.json?limit=' + limit + '&raw_json=1');
        return children.slice(0, limit).map(c => {
            let body = c.data.body || '';
            if (body.length > 300) body = body.slice(0, 300) + '...';
            return {
                subreddit: c.data.subreddit_name_prefixed,
                score: c.data.score,
                body: body,
                url: 'https://www.reddit.com' + c.data.permalink,
            };
        });
    },
});
