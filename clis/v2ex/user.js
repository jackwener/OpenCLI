import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'user',
    description: 'V2EX 用户发帖列表',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'username', required: true, positional: true, help: 'Username' },
        {
            name: 'limit',
            type: 'int',
            default: 10,
            help: 'Number of topics (API returns max 20)',
        },
    ],
    columns: ['rank', 'title', 'node', 'replies', 'url'],
    pipeline: [
        { fetch: {
                url: 'https://www.v2ex.com/api/topics/show.json',
                params: { username: '${{ args.username }}' },
            } },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                node: '${{ item.node.title }}',
                replies: '${{ item.replies }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
