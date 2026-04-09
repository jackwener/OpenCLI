import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'bluesky',
  name: 'followers',
  description: 'List followers of a Bluesky user',
  domain: 'public.api.bsky.app',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'handle', required: true, positional: true, help: 'Bluesky handle' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of followers' },
  ],
  columns: ['rank', 'handle', 'name', 'description'],
  pipeline: [
    { fetch: {
        url: 'https://public.api.bsky.app/xrpc/app.bsky.graph.getFollowers?actor=${{ args.handle }}&limit=${{ args.limit }}',
      } },
    { select: 'followers' },
    { map: {
        rank: '${{ index + 1 }}',
        handle: '${{ item.handle }}',
        name: '${{ item.displayName }}',
        description: '${{ item.description }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
