import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'devto',
  name: 'top',
  description: 'Top DEV.to articles of the day',
  domain: 'dev.to',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of articles' },
  ],
  columns: ['rank', 'title', 'author', 'reactions', 'comments', 'tags'],
  pipeline: [
    { fetch: { url: 'https://dev.to/api/articles?top=1&per_page=${{ args.limit }}' } },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        author: '${{ item.user.username }}',
        reactions: '${{ item.public_reactions_count }}',
        comments: '${{ item.comments_count }}',
        tags: `\${{ item.tag_list | join(', ') }}`,
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
