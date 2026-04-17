import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'hot',
    description: 'Reddit 热门帖子',
    domain: 'www.reddit.com',
    args: [
        {
            name: 'subreddit',
            default: '',
            help: 'Subreddit name (e.g. programming). Empty for frontpage',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['rank', 'title', 'subreddit', 'score', 'comments'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  const sub = \${{ args.subreddit | json }};
  const path = sub ? '/r/' + sub + '/hot.json' : '/hot.json';
  const limit = \${{ args.limit }};
  const res = await fetch(path + '?limit=' + limit + '&raw_json=1', {
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
            } },
        { limit: '${{ args.limit }}' },
    ],
});
