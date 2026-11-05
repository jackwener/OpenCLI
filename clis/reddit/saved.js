import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchRedditJson, fetchRedditListing } from './api.js';
cli({
    site: 'reddit',
    name: 'saved',
    access: 'read',
    description: 'Browse your saved Reddit posts',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['title', 'subreddit', 'score', 'comments', 'url'],
    func: async (page, kwargs) => {
        if (!page)
            throw new CommandExecutionError('Browser session required');
        await page.goto('https://www.reddit.com');
        const me = await fetchRedditJson(page, '/api/me.json?raw_json=1');
        const username = me?.name || me?.data?.name;
        if (!username)
            throw new AuthRequiredError('reddit.com', 'Not logged in — cannot determine username');
        const limit = kwargs.limit;
        const children = await fetchRedditListing(page, '/user/' + encodeURIComponent(username) + '/saved.json?limit=' + limit + '&raw_json=1');
        return children.slice(0, limit).map(c => ({
            title: c.data.title || c.data.body?.slice(0, 100) || '',
            subreddit: c.data.subreddit_name_prefixed || 'r/' + (c.data.subreddit || '?'),
            score: c.data.score || 0,
            comments: c.data.num_comments || 0,
            url: 'https://www.reddit.com' + (c.data.permalink || ''),
        }));
    }
});
