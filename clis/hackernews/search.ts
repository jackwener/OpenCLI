import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'hackernews',
  name: 'search',
  description: 'Search Hacker News stories',
  domain: 'news.ycombinator.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    {
      name: 'sort',
      default: 'relevance',
      help: 'Sort by relevance or date',
      choices: ['relevance', 'date'],
    },
  ],
  columns: ['rank', 'title', 'score', 'author', 'comments', 'url'],
  pipeline: [
    { fetch: {
        url: `https://hn.algolia.com/api/v1/\${{ args.sort === 'date' ? 'search_by_date' : 'search' }}`,
        params: { query: '${{ args.query }}', tags: 'story', hitsPerPage: '${{ args.limit }}' },
      } },
    { select: 'hits' },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        score: '${{ item.points }}',
        author: '${{ item.author }}',
        comments: '${{ item.num_comments }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
