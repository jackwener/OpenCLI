import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRedditMedia, fetchRedditListing } from './api.js';
cli({
    site: 'reddit',
    name: 'frontpage',
    access: 'read',
    description: 'Reddit Frontpage / r/all',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['title', 'subreddit', 'author', 'upvotes', 'comments', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        await page.goto('https://www.reddit.com');
        const limit = kwargs.limit ?? 15;
        const children = await fetchRedditListing(page, '/r/all.json?limit=' + limit + '&raw_json=1');
        return children.slice(0, limit).map(c => ({
            title: c.data.title,
            subreddit: c.data.subreddit_name_prefixed,
            author: c.data.author,
            upvotes: c.data.score,
            comments: c.data.num_comments,
            url: 'https://www.reddit.com' + c.data.permalink,
            ...extractRedditMedia(c.data),
        }));
    },
});
