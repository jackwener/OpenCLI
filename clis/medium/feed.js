import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildMediumTagUrl, loadMediumPosts } from './utils.js';
cli({
    site: 'medium',
    name: 'feed',
    access: 'read',
    description: 'Medium 热门文章 Feed',
    domain: 'medium.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'topic', default: '', help: '话题标签（如 technology, programming, ai）' },
        { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
    ],
    columns: ['rank', 'title', 'author', 'date', 'readTime', 'claps'],
    func: async (page, args) => loadMediumPosts(page, buildMediumTagUrl(args.topic), Number(args.limit) || 20),
});
