import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadSubstackArchive } from './utils.js';
cli({
    site: 'substack',
    name: 'publication',
    description: '获取特定 Substack Newsletter 的最新文章',
    domain: 'substack.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'Newsletter URL（如 https://example.substack.com）' },
        { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
    ],
    columns: ['rank', 'title', 'date', 'description', 'url'],
    func: async (page, args) => loadSubstackArchive(page, args.url.replace(/\/$/, ''), Number(args.limit) || 20),
});
