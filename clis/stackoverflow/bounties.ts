import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'stackoverflow',
  name: 'bounties',
  description: 'Active bounties on Stack Overflow',
  domain: 'stackoverflow.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Max number of results' },
  ],
  columns: ['bounty', 'title', 'score', 'answers', 'url'],
  pipeline: [
    { fetch: {
        url: 'https://api.stackexchange.com/2.3/questions/featured?order=desc&sort=activity&site=stackoverflow',
      } },
    { select: 'items' },
    { map: {
        title: '${{ item.title }}',
        bounty: '${{ item.bounty_amount }}',
        score: '${{ item.score }}',
        answers: '${{ item.answer_count }}',
        url: '${{ item.link }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
