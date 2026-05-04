import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'devto',
    name: 'tag',
    access: 'read',
    description: 'Latest DEV.to articles for a specific tag',
    domain: 'dev.to',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'tag',
            required: true,
            positional: true,
            help: 'Tag name (e.g. javascript, python, webdev)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of articles' },
    ],
    columns: ['rank', 'id', 'title', 'author', 'reactions', 'comments', 'reading_time', 'published_at', 'tags', 'url'],
    pipeline: [
        { fetch: { url: 'https://dev.to/api/articles?tag=${{ args.tag }}&per_page=${{ args.limit }}' } },
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
