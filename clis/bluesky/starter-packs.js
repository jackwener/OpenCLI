import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'starter-packs',
    access: 'read',
    description: 'Get starter packs created by a Bluesky user',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'handle', required: true, positional: true, help: 'Bluesky handle' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of starter packs' },
    ],
    columns: ['rank', 'name', 'description', 'members', 'joins'],
    pipeline: [
        { fetch: {
                url: 'https://public.api.bsky.app/xrpc/app.bsky.graph.getActorStarterPacks?actor=${{ args.handle }}&limit=${{ args.limit }}',
            } },
        { select: 'starterPacks' },
        { map: {
                rank: '${{ index + 1 }}',
                name: '${{ item.record.name }}',
                description: '${{ item.record.description }}',
                members: '${{ item.listItemCount }}',
                joins: '${{ item.joinedAllTimeCount }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
