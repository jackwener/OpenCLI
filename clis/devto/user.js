import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'devto',
    name: 'user',
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
    columns: ['rank', 'title', 'reactions', 'comments', 'tags'],
    pipeline: [
        { fetch: { url: 'https://dev.to/api/articles?username=${{ args.username }}&per_page=${{ args.limit }}' } },
        { map: {
                rank: '${{ index + 1 }}',
                title: '${{ item.title }}',
                reactions: '${{ item.public_reactions_count }}',
                comments: '${{ item.comments_count }}',
                tags: `\${{ item.tag_list | join(', ') }}`,
                url: '${{ item.url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
