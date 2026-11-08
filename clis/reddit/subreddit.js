import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractRedditMedia, fetchRedditListingWithHtmlFallback } from './api.js';
cli({
    site: 'reddit',
    name: 'subreddit',
    access: 'read',
    description: 'Get posts from a specific Subreddit',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'name', type: 'string', required: true, positional: true, help: 'Subreddit name (no `r/` prefix; e.g. `python`)' },
        {
            name: 'sort',
            type: 'string',
            default: 'hot',
            help: 'Sorting method: hot, new, top, rising, controversial',
        },
        {
            name: 'time',
            type: 'string',
            default: 'all',
            help: 'Time filter for top/controversial: hour, day, week, month, year, all',
        },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['id', 'title', 'subreddit', 'author', 'upvotes', 'comments', 'url', 'created_utc', 'selftext', 'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls'],
    func: async (page, kwargs) => {
        let sub = String(kwargs.name ?? '');
        if (sub.startsWith('r/')) sub = sub.slice(2);
        const sort = String(kwargs.sort ?? 'hot');
        const time = kwargs.time ?? 'all';
        const limit = kwargs.limit ?? 15;
        let path = '/r/' + encodeURIComponent(sub) + '/' + encodeURIComponent(sort) + '.json?limit=' + limit + '&raw_json=1';
        const feed = new URLSearchParams({ name: sub });
        if ((sort === 'top' || sort === 'controversial') && time) {
            path += '&t=' + encodeURIComponent(time);
            feed.set('t', String(time));
        }
        const htmlPath = '/svc/shreddit/community-more-posts/' + encodeURIComponent(sort) + '/?' + feed.toString();
        const children = await fetchRedditListingWithHtmlFallback(page, path, htmlPath, limit);
        return children.slice(0, limit).map(c => ({
            id: c.data.id,
            title: c.data.title,
            subreddit: c.data.subreddit_name_prefixed,
            author: c.data.author,
            upvotes: c.data.score,
            comments: c.data.num_comments,
            url: 'https://www.reddit.com' + c.data.permalink,
            created_utc: c.data.created_utc,
            selftext: c.data.selftext || '',
            ...extractRedditMedia(c.data),
        }));
    },
});
