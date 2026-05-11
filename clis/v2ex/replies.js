import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'replies',
    access: 'read',
    description: 'V2EX 主题回复列表',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Topic ID' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of replies' },
    ],
    columns: ['floor', 'author', 'content'],
    pipeline: [
        { fetch: {
                url: 'https://www.v2ex.com/api/replies/show.json',
                params: { topic_id: '${{ args.id }}' },
            } },
        { map: {
                floor: '${{ index + 1 }}',
                author: '${{ item.member.username }}',
                content: '${{ item.content }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
