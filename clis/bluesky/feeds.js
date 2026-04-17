import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'feeds',
    description: 'Popular Bluesky feed generators',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of feeds' },
    ],
    columns: ['rank', 'name', 'likes', 'creator', 'description'],
    pipeline: [
        { fetch: {
                url: 'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getPopularFeedGenerators?limit=${{ args.limit }}',
            } },
        { select: 'feeds' },
        { map: {
                rank: '${{ index + 1 }}',
                name: '${{ item.displayName }}',
                likes: '${{ item.likeCount }}',
                creator: '${{ item.creator.handle }}',
                description: '${{ item.description }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
