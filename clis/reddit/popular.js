import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRedditMedia, fetchRedditListing } from './api.js';
cli({
    site: 'reddit',
    name: 'popular',
    access: 'read',
    description: 'Reddit Popular posts (/r/popular)',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['rank', 'id', 'title', 'subreddit', 'score', 'comments', 'author', 'url', 'created_utc', 'selftext', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit ?? 20;
        const children = await fetchRedditListing(page, '/r/popular.json?limit=' + limit + '&raw_json=1');
        return children.slice(0, limit).map((c, index) => ({
            rank: index + 1,
            id: c.data.id,
            title: c.data.title,
            subreddit: c.data.subreddit_name_prefixed,
            score: c.data.score,
            comments: c.data.num_comments,
            author: c.data.author,
            url: 'https://www.reddit.com' + c.data.permalink,
            created_utc: c.data.created_utc,
            selftext: c.data.selftext || '',
            ...extractRedditMedia(c.data),
        }));
    },
});
