import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'v2ex',
  name: 'node',
  description: 'V2EX 节点话题列表',
  domain: 'www.v2ex.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'name',
      required: true,
      positional: true,
      help: 'Node name (e.g. python, javascript, apple)',
    },
    {
      name: 'limit',
      type: 'int',
      default: 10,
      help: 'Number of topics (API returns max 20)',
    },
  ],
  columns: ['rank', 'title', 'author', 'replies', 'url'],
  pipeline: [
    { fetch: {
        url: 'https://www.v2ex.com/api/topics/show.json',
        params: { node_name: '${{ args.name }}' },
      } },
    { map: {
        rank: '${{ index + 1 }}',
        title: '${{ item.title }}',
        author: '${{ item.member.username }}',
        replies: '${{ item.replies }}',
        url: '${{ item.url }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
