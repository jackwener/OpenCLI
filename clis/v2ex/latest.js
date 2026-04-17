import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'latest',
    description: 'V2EX 最新话题',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of topics' },
    ],
    columns: ['id', 'rank', 'title', 'node', 'replies', 'url'],
    pipeline: [
        { fetch: { url: 'https://www.v2ex.com/api/topics/latest.json' } },
        { map: {
                id: '${{ item.id }}',
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                node: '${{ item.node.title }}',
                replies: '${{ item.replies }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
