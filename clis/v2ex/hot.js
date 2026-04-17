import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'hot',
    description: 'V2EX 热门话题',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of topics' },
    ],
    columns: ['id', 'rank', 'title', 'node', 'replies', 'url'],
    pipeline: [
        { fetch: { url: 'https://www.v2ex.com/api/topics/hot.json' } },
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
