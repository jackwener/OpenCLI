import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'v2ex',
    name: 'topic',
    access: 'read',
    description: 'V2EX 主题详情和回复',
    domain: 'www.v2ex.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', required: true, positional: true, help: 'Topic ID' },
    ],
    columns: ['id', 'title', 'content', 'member', 'created', 'node', 'replies', 'url'],
    pipeline: [
        { fetch: {
                url: 'https://www.v2ex.com/api/topics/show.json',
                params: { id: '${{ args.id }}' },
            } },
        { map: {
                id: '${{ item.id }}',
                title: '${{ item.title }}',
                content: '${{ item.content }}',
                member: '${{ item.member.username }}',
                created: '${{ item.created }}',
                node: '${{ item.node.title }}',
                replies: '${{ item.replies }}',
                url: '${{ item.url }}',
            } },
        { limit: 1 },
    ],
});
