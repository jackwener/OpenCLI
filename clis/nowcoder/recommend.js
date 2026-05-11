import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'nowcoder',
    name: 'recommend',
    access: 'read',
    description: 'Recommended feed',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of items' },
    ],
    columns: ['rank', 'title', 'author', 'likes', 'comments', 'views', 'id'],
    pipeline: [
        { fetch: { url: 'https://gw-c.nowcoder.com/api/sparta/home/recommend?page=${{ args.page }}&size=${{ args.limit }}' } },
        { select: 'data.records' },
        { map: {
                rank: '${{ index + 1 }}',
                title: `\${{ item.momentData?.title || item.longContentData?.title || item.contentData?.title || '' }}`,
                author: `\${{ item.userBrief?.nickname || '' }}`,
                likes: '${{ item.frequencyData?.likeCnt || 0 }}',
                comments: '${{ item.frequencyData?.commentCnt || 0 }}',
                views: '${{ item.frequencyData?.viewCnt || 0 }}',
                id: `\${{ item.momentData?.uuid || item.longContentData?.uuid || item.contentData?.uuid || item.contentId || '' }}`,
            } },
        { filter: 'item.title' },
        { limit: '${{ args.limit }}' },
    ],
});
