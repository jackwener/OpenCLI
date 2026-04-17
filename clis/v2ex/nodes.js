import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'nodes',
    description: 'V2EX 所有节点列表',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of nodes' },
    ],
    columns: ['rank', 'name', 'title', 'topics', 'stars'],
    pipeline: [
        { fetch: { url: 'https://www.v2ex.com/api/nodes/all.json' } },
        { sort: { by: 'topics', order: 'desc' } },
        { map: {
                rank: '${{ index + 1 }}',
                name: '${{ item.name }}',
                title: '${{ item.title }}',
                topics: '${{ item.topics }}',
                stars: '${{ item.stars }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
