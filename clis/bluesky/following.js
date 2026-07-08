import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'following',
    access: 'read',
    description: 'List accounts a Bluesky user is following',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'handle', required: true, positional: true, help: 'Bluesky handle' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of accounts' },
    ],
    columns: ['rank', 'handle', 'name', 'description'],
    pipeline: [
        { fetch: {
                url: 'https://public.api.bsky.app/xrpc/app.bsky.graph.getFollows?actor=${{ args.handle }}&limit=${{ args.limit }}',
            } },
        { select: 'follows' },
        { map: {
                rank: '${{ index + 1 }}',
                handle: '${{ item.handle }}',
                name: '${{ item.displayName }}',
                description: '${{ item.description }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
