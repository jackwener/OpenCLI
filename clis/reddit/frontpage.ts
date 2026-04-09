import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'reddit',
  name: 'frontpage',
  description: 'Reddit Frontpage / r/all',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['title', 'subreddit', 'author', 'upvotes', 'comments', 'url'],
  pipeline: [
    { navigate: 'https://www.reddit.com' },
    { evaluate: `(async () => {
  const res = await fetch('/r/all.json?limit=\${{ args.limit }}', { credentials: 'include' });
  const j = await res.json();
  return j?.data?.children || [];
})()
` },
    { map: {
        title: '${{ item.data.title }}',
        subreddit: '${{ item.data.subreddit_name_prefixed }}',
        author: '${{ item.data.author }}',
        upvotes: '${{ item.data.score }}',
        comments: '${{ item.data.num_comments }}',
        url: 'https://www.reddit.com${{ item.data.permalink }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
