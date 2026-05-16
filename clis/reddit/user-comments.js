import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'user-comments',
    access: 'read',
    description: `View a Reddit user's comment history`,
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Reddit username (no `u/` prefix needed)' },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['subreddit', 'score', 'body', 'url'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  const username = \${{ args.username | json }};
  const name = username.startsWith('u/') ? username.slice(2) : username;
  const limit = \${{ args.limit }};
  const res = await fetch('/user/' + name + '/comments.json?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data?.children || []).map(c => {
    let body = c.data.body || '';
    if (body.length > 300) body = body.slice(0, 300) + '...';
    return {
      subreddit: c.data.subreddit_name_prefixed,
      score: c.data.score,
      body: body,
      url: 'https://www.reddit.com' + c.data.permalink,
    };
  });
})()
` },
        { map: {
                subreddit: '${{ item.subreddit }}',
                score: '${{ item.score }}',
                body: '${{ item.body }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
