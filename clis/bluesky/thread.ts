import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'bluesky',
  name: 'thread',
  description: 'Get a Bluesky post thread with replies',
  domain: 'public.api.bsky.app',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'uri',
      required: true,
      positional: true,
      help: 'Post AT URI (at://did:.../app.bsky.feed.post/...) or bsky.app URL',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Number of replies' },
  ],
  columns: ['author', 'text', 'likes', 'reposts', 'replies_count'],
  pipeline: [
    { fetch: { url: 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${{ args.uri }}&depth=2' } },
    { select: 'thread' },
    { map: {
        author: '${{ item.post.author.handle }}',
        text: '${{ item.post.record.text }}',
        likes: '${{ item.post.likeCount }}',
        reposts: '${{ item.post.repostCount }}',
        replies_count: '${{ item.post.replyCount }}',
      } },
  ],
});
