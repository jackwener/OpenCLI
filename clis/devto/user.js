import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'devto',
    name: 'user',
    access: 'read',
    description: 'Recent DEV.to articles from a specific user',
    domain: 'dev.to',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'DEV.to username (e.g. ben, thepracticaldev)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of articles' },
    ],
    columns: ['rank', 'id', 'title', 'reactions', 'comments', 'reading_time', 'published_at', 'tags', 'url'],
    pipeline: [
        { fetch: { url: 'https://dev.to/api/articles?username=${{ args.username }}&per_page=${{ args.limit }}' } },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.id }}',
                title: '${{ item.title }}',
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
