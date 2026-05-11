import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'topics',
    access: 'read',
    description: 'Hot discussion topics',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of items' },
    ],
    columns: ['rank', 'topic', 'views', 'posts', 'heat', 'id'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/subject/hot-subject' } },
        { select: 'data.result' },
        { map: {
                rank: '${{ index + 1 }}',
                topic: '${{ item.content }}',
                views: '${{ item.viewCount }}',
                posts: '${{ item.momentCount }}',
                heat: '${{ item.hotValue }}',
                id: '${{ item.uuid || item.id || "" }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
