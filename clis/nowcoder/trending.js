import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'trending',
    description: 'Trending posts',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'title', 'heat', 'id'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/hot-search/top-hot-pc' } },
        { select: 'data.result' },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                heat: '${{ item.hotValueFromDolphin }}',
                id: '${{ item.uuid || item.id || "" }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
