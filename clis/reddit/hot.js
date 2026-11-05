import { cli } from '@jackwener/opencli/registry';
import { extractRedditMedia, fetchRedditListing } from './api.js';
cli({
    site: 'reddit',
    name: 'hot',
    access: 'read',
    description: 'Reddit 热门帖子',
    domain: 'www.reddit.com',
    args: [
        {
            name: 'subreddit',
            default: '',
            help: 'Subreddit name (e.g. programming). Empty for frontpage',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        await page.goto('https://www.reddit.com');
        const sub = String(kwargs.subreddit ?? '');
        const limit = kwargs.limit ?? 20;
        const path = sub ? '/r/' + encodeURIComponent(sub) + '/hot.json' : '/hot.json';
        const children = await fetchRedditListing(page, path + '?limit=' + limit + '&raw_json=1');
        return children.slice(0, limit).map((c, index) => ({
            rank: index + 1,
            title: c.data.title,
            subreddit: c.data.subreddit_name_prefixed,
            score: c.data.score,
            comments: c.data.num_comments,
            postId: c.data.id,
            author: c.data.author,
            url: 'https://www.reddit.com' + c.data.permalink,
            ...extractRedditMedia(c.data),
        }));
    },
});
