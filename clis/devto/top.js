import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'devto',
    name: 'top',
    access: 'read',
    description: 'Top DEV.to articles of the day',
    domain: 'dev.to',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of articles' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'reactions', 'comments', 'reading_time', 'published_at', 'tags', 'url'],
    pipeline: [
        { fetch: { url: 'https://dev.to/api/articles?top=1&per_page=${{ args.limit }}' } },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.id }}',
                title: '${{ item.title }}',
                author: '${{ item.user.username }}',
                reactions: '${{ item.public_reactions_count }}',
                comments: '${{ item.comments_count }}',
                reading_time: '${{ item.reading_time_minutes }}',
                published_at: '${{ item.published_at }}',
                tags: `\${{ item.tag_list | join(', ') }}`,
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
