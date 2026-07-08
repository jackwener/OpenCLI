import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'lobsters',
    name: 'hot',
    access: 'read',
    description: 'Lobste.rs hottest stories',
    domain: 'lobste.rs',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of stories' },
    ],
    columns: ['rank', 'id', 'title', 'score', 'author', 'comments', 'created_at', 'tags', 'url'],
    pipeline: [
        { fetch: { url: 'https://lobste.rs/hottest.json' } },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.short_id }}',
                title: '${{ item.title }}',
                score: '${{ item.score }}',
                author: '${{ item.submitter_user }}',
                comments: '${{ item.comment_count }}',
                created_at: '${{ item.created_at }}',
                tags: `\${{ item.tags | join(', ') }}`,
                url: '${{ item.comments_url }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
