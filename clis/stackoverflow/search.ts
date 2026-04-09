import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'stackoverflow',
  name: 'search',
  description: 'Search Stack Overflow questions',
  domain: 'stackoverflow.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', type: 'string', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Max number of results' },
  ],
  columns: ['title', 'score', 'answers', 'url'],
  pipeline: [
    { fetch: {
        url: 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${{ args.query }}&site=stackoverflow',
      } },
    { select: 'items' },
    { map: {
        title: '${{ item.title }}',
        score: '${{ item.score }}',
        answers: '${{ item.answer_count }}',
        url: '${{ item.link }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
