import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'lobsters',
  name: 'newest',
  description: 'Lobste.rs newest stories',
  domain: 'lobste.rs',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of stories' },
  ],
  columns: ['rank', 'title', 'score', 'author', 'comments', 'tags'],
  pipeline: [
    { fetch: { url: 'https://lobste.rs/newest.json' } },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        score: '${{ item.score }}',
        author: '${{ item.submitter_user }}',
        comments: '${{ item.comment_count }}',
        tags: `\${{ item.tags | join(', ') }}`,
        url: '${{ item.comments_url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
