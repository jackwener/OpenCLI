import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'profile',
    access: 'read',
    description: 'Get Bluesky user profile info',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'handle',
            required: true,
            positional: true,
            help: 'Bluesky handle (e.g. bsky.app, jay.bsky.team)',
        },
    ],
    columns: ['handle', 'name', 'followers', 'following', 'posts', 'description'],
    pipeline: [
        { fetch: { url: 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${{ args.handle }}' } },
        { map: {
                handle: '${{ item.handle }}',
                name: '${{ item.displayName }}',
                followers: '${{ item.followersCount }}',
                following: '${{ item.followsCount }}',
                posts: '${{ item.postsCount }}',
                description: '${{ item.description }}',
            } },
    ],
});
