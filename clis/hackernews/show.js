import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'hackernews',
    name: 'show',
    description: 'Hacker News Show HN posts',
    domain: 'news.ycombinator.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of stories' },
    ],
    columns: ['rank', 'title', 'score', 'author', 'comments'],
    pipeline: [
        { fetch: { url: 'https://hacker-news.firebaseio.com/v0/showstories.json' } },
        { limit: '${{ Math.min((args.limit ? args.limit : 20) + 10, 50) }}' },
        { map: { id: '${{ item }}' } },
        { fetch: { url: 'https://hacker-news.firebaseio.com/v0/item/${{ item.id }}.json' } },
        { filter: 'item.title && !item.deleted && !item.dead' },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                score: '${{ item.score }}',
                author: '${{ item.by }}',
                comments: '${{ item.descendants }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
