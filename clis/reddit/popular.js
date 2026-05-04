import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'popular',
    access: 'read',
    description: 'Reddit Popular posts (/r/popular)',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['rank', 'id', 'title', 'subreddit', 'score', 'comments', 'author', 'url', 'created_utc', 'selftext'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  const res = await fetch('/r/popular.json?limit=' + limit + '&raw_json=1', {
    credentials: 'include'
  });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    id: c.data.id,
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    score: c.data.score,
    comments: c.data.num_comments,
    author: c.data.author,
    url: 'https://www.reddit.com' + c.data.permalink,
    created_utc: c.data.created_utc,
    selftext: c.data.selftext || '',
  }));
})()
` },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.id }}',
                title: '${{ item.title }}',
                subreddit: '${{ item.subreddit }}',
                score: '${{ item.score }}',
                comments: '${{ item.comments }}',
                author: '${{ item.author }}',
                url: '${{ item.url }}',
                created_utc: '${{ item.created_utc }}',
                selftext: '${{ item.selftext }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
