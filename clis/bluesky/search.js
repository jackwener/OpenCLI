import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'search',
    description: 'Search Bluesky users',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'handle', 'name', 'followers', 'description'],
    pipeline: [
        { fetch: {
                url: 'https://public.api.bsky.app/xrpc/app.bsky.actor.searchActors?q=${{ args.query }}&limit=${{ args.limit }}',
            } },
        { select: 'actors' },
        { map: {
                rank: '${{ index + 1 }}',
                handle: '${{ item.handle }}',
                name: '${{ item.displayName }}',
                followers: '${{ item.followersCount }}',
                description: '${{ item.description }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
