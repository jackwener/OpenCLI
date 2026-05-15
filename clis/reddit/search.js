import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'reddit',
    name: 'search',
    access: 'read',
    description: 'Search Reddit Posts',
    domain: 'reddit.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Reddit search query' },
        {
            name: 'subreddit',
            type: 'string',
            default: '',
            help: 'Search within a specific subreddit',
        },
        {
            name: 'sort',
            type: 'string',
            default: 'relevance',
            help: 'Sort order: relevance, hot, top, new, comments',
        },
        {
            name: 'time',
            type: 'string',
            default: 'all',
            help: 'Time filter: hour, day, week, month, year, all',
        },
        { name: 'limit', type: 'int', default: 15 },
    ],
    columns: ['title', 'subreddit', 'author', 'score', 'comments', 'url'],
    pipeline: [
        { navigate: 'https://www.reddit.com' },
        { evaluate: `(async () => {
  const q = encodeURIComponent(\${{ args.query | json }});
  const sub = \${{ args.subreddit | json }};
  const sort = \${{ args.sort | json }};
  const time = \${{ args.time | json }};
  const limit = \${{ args.limit }};
  const basePath = sub ? '/r/' + sub + '/search.json' : '/search.json';
  const params = 'q=' + q + '&sort=' + sort + '&t=' + time + '&limit=' + limit
    + '&restrict_sr=' + (sub ? 'on' : 'off') + '&raw_json=1';
  const res = await fetch(basePath + '?' + params, { credentials: 'include' });
  const d = await res.json();
  return (d?.data?.children || []).map(c => ({
    title: c.data.title,
    subreddit: c.data.subreddit_name_prefixed,
    author: c.data.author,
    score: c.data.score,
    comments: c.data.num_comments,
    url: 'https://www.reddit.com' + c.data.permalink,
  }));
})()
` },
        { map: {
                title: '${{ item.title }}',
                subreddit: '${{ item.subreddit }}',
                author: '${{ item.author }}',
                score: '${{ item.score }}',
                comments: '${{ item.comments }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
