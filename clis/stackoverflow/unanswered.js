import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'stackoverflow',
    name: 'unanswered',
    access: 'read',
    description: 'Top voted unanswered questions on Stack Overflow',
    domain: 'stackoverflow.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Max number of results' },
    ],
    columns: ['rank', 'id', 'title', 'score', 'answers', 'views', 'tags', 'author', 'creation_date', 'url'],
    pipeline: [
        { fetch: {
                url: 'https://api.stackexchange.com/2.3/questions/unanswered?order=desc&sort=votes&site=stackoverflow&pagesize=${{ args.limit }}',
            } },
        { select: 'items' },
        { map: {
                rank: '${{ index + 1 }}',
                id: '${{ item.question_id }}',
                title: '${{ item.title }}',
                score: '${{ item.score }}',
                answers: '${{ item.answer_count }}',
                views: '${{ item.view_count }}',
                tags: `\${{ item.tags | join(', ') }}`,
                author: '${{ item.owner.display_name }}',
                creation_date: '${{ item.creation_date }}',
                url: '${{ item.link }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
