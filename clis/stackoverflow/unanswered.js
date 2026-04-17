import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'stackoverflow',
    name: 'unanswered',
    description: 'Top voted unanswered questions on Stack Overflow',
    domain: 'stackoverflow.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Max number of results' },
    ],
    columns: ['title', 'score', 'answers', 'url'],
    pipeline: [
        { fetch: {
                url: 'https://api.stackexchange.com/2.3/questions/unanswered?order=desc&sort=votes&site=stackoverflow',
            } },
        { select: 'items' },
        { map: {
                title: '${{ item.title }}',
                score: '${{ item.score }}',
                answers: '${{ item.answer_count }}',
                url: '${{ item.link }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
