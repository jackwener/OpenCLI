import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'user',
    access: 'read',
    description: 'Get recent posts from a Bluesky user',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'handle',
            required: true,
            positional: true,
            help: 'Bluesky handle (e.g. bsky.app)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'uri', 'text', 'likes', 'reposts', 'replies'],
    pipeline: [
        { fetch: {
                url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${{ args.handle }}&limit=${{ args.limit }}',
            } },
        { select: 'feed' },
        { map: {
                rank: '${{ index + 1 }}',
                uri: '${{ item.post.uri }}',
                text: '${{ item.post.record.text }}',
                likes: '${{ item.post.likeCount }}',
                reposts: '${{ item.post.repostCount }}',
                replies: '${{ item.post.replyCount }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
