import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'hot',
    description: 'Hot search ranking',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'title', 'heat'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/hot-search/hot-content' } },
        { select: 'data.hotQuery' },
        { map: {
                rank: '${{ item.rank }}',
                title: '${{ item.query }}',
                heat: '${{ item.hotValue }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
