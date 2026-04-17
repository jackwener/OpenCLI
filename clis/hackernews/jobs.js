import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'hackernews',
    name: 'jobs',
    description: 'Hacker News job postings',
    domain: 'news.ycombinator.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of job postings' },
    ],
    columns: ['rank', 'title', 'author', 'url'],
    pipeline: [
        { fetch: { url: 'https://hacker-news.firebaseio.com/v0/jobstories.json' } },
        { limit: '${{ Math.min((args.limit ? args.limit : 20) + 10, 50) }}' },
        { map: { id: '${{ item }}' } },
        { fetch: { url: 'https://hacker-news.firebaseio.com/v0/item/${{ item.id }}.json' } },
        { filter: 'item.title && !item.deleted && !item.dead' },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                author: '${{ item.by }}',
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
