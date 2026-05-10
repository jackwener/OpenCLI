import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'bluesky',
    name: 'trending',
    access: 'read',
    description: 'Trending topics on Bluesky',
    domain: 'public.api.bsky.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of topics' },
    ],
    columns: ['rank', 'topic', 'link'],
    pipeline: [
        { fetch: { url: 'https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics' } },
        { select: 'topics' },
        { map: { rank: '${{ index + 1 }}', topic: '${{ item.topic }}', link: '${{ item.link }}' } },
        { limit: '${{ args.limit }}' },
    ],
});
