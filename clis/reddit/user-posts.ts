import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'reddit',
  name: 'user-posts',
  description: `View a Reddit user's submitted posts`,
  domain: 'reddit.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'username', type: 'string', required: true, positional: true },
    { name: 'limit', type: 'int', default: 15 },
  ],
  columns: ['title', 'subreddit', 'score', 'comments', 'url'],
  pipeline: [
    { navigate: 'https://www.reddit.com' },
    { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const name = username.startsWith('u/') ? username.slice(2) : username;
  const limit = \${{ args.limit }};
  const res = await fetch('/user/' + name + '/submitted.json?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    score: c.data.score,
    comments: c.data.num_comments,
    url: 'https://www.reddit.com' + c.data.permalink,
  }));
})()
` },
    { map: {
        title: '${{ item.title }}',
        subreddit: '${{ item.subreddit }}',
        score: '${{ item.score }}',
        comments: '${{ item.comments }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
