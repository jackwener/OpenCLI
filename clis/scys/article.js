import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractScysArticle } from './extractors.js';
cli({
    site: 'scys',
    name: 'article',
    description: 'Extract SCYS article detail page content and metadata',
    domain: 'scys.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', required: true, positional: true, help: 'Article URL or topic id: /articleDetail/<entityType>/<topicId>' },
        { name: 'wait', type: 'int', default: 5, help: 'Seconds to wait after page load' },
        { name: 'max-length', type: 'int', default: 4000, help: 'Max content length for long text fields' },
    ],
    columns: ['topic_id', 'entity_type', 'title', 'author', 'time', 'tags', 'flags', 'image_count', 'external_link_count', 'content', 'ai_summary', 'url'],
    func: async (page, kwargs) => {
        return extractScysArticle(page, String(kwargs.url), {
            waitSeconds: Number(kwargs.wait ?? 5),
            maxLength: Number(kwargs['max-length'] ?? 4000),
        });
    },
});
