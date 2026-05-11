import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'xiaohongshu',
    name: 'feed',
    access: 'read',
    description: '小红书首页推荐 Feed (via Pinia Store Action)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.INTERCEPT,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['id', 'title', 'author', 'likes', 'type', 'url'],
    pipeline: [
        { navigate: 'https://www.xiaohongshu.com/explore' },
        { tap: {
                store: 'feed',
                action: 'fetchFeeds',
                capture: 'homefeed',
                select: 'data.items',
                timeout: 8,
            } },
        { map: {
                id: '${{ item.id }}',
                title: '${{ item.note_card.display_title }}',
                type: '${{ item.note_card.type }}',
                author: '${{ item.note_card.user.nickname }}',
                likes: '${{ item.note_card.interact_info.liked_count }}',
                url: 'https://www.xiaohongshu.com/explore/${{ item.id }}',
            } },
        { limit: '${{ args.limit | default(20) }}' },
    ],
});
