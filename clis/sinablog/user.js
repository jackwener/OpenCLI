import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadSinaBlogUser } from './utils.js';
cli({
    site: 'sinablog',
    name: 'user',
    access: 'read',
    description: '获取新浪博客用户的文章列表',
    domain: 'blog.sina.com.cn',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'uid', required: true, positional: true, help: '新浪博客用户ID（如 1234567890）' },
        { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'readCount', 'url'],
    func: async (page, args) => loadSinaBlogUser(page, args.uid, Number(args.limit) || 20),
});
