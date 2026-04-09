import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'reddit',
  name: 'subreddit',
  description: 'Get posts from a specific Subreddit',
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'name', type: 'string', required: true, positional: true },
    {
      name: 'sort',
      type: 'string',
      default: 'hot',
      help: 'Sorting method: hot, new, top, rising, controversial',
    },
    {
      name: 'time',
      type: 'string',
      default: 'all',
      help: 'Time filter for top/controversial: hour, day, week, month, year, all',
    },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['title', 'author', 'upvotes', 'comments', 'url'],
  pipeline: [
    { navigate: 'https://www.reddit.com' },
    { evaluate: `(async () => {
  let sub = \${{ args.name | json }};
  if (sub.startsWith('r/')) sub = sub.slice(2);
  const sort = \${{ args.sort | json }};
  const time = \${{ args.time | json }};
  const limit = \${{ args.limit }};
  let url = '/r/' + sub + '/' + sort + '.json?limit=' + limit + '&raw_json=1';
  if ((sort === 'top' || sort === 'controversial') && time) {
    url += '&t=' + time;
  }
  const res = await fetch(url, { credentials: 'include' });
  const j = await res.json();
  return j?.data?.children || [];
})()
` },
    { map: {
        title: '${{ item.data.title }}',
        author: '${{ item.data.author }}',
        upvotes: '${{ item.data.score }}',
        comments: '${{ item.data.num_comments }}',
        url: 'https://www.reddit.com${{ item.data.permalink }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
