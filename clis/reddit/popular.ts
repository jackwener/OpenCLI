import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'reddit',
  name: 'popular',
  description: 'Reddit Popular posts (/r/popular)',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['rank', 'title', 'subreddit', 'score', 'comments', 'url'],
  pipeline: [
    { navigate: 'https://www.reddit.com' },
    { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const res = await fetch('/r/popular.json?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    url: 'https://www.reddit.com' + c.data.permalink,
  }));
})()
` },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        subreddit: '${{ item.subreddit }}',
        score: '${{ item.score }}',
        comments: '${{ item.comments }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
