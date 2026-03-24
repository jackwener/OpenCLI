import { cli, Strategy } from '../../registry.js';
import { buildMediumSearchUrl, loadMediumPosts } from './utils.js';

cli({
  site: 'medium',
  name: 'search',
  description: '搜索 Medium 文章',
  domain: 'medium.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'keyword', required: true, positional: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
  ],
  columns: ['rank', 'title', 'author', 'date', 'readTime', 'claps'],
  func: async (page, args) => loadMediumPosts(page, buildMediumSearchUrl(args.keyword), Number(args.limit) || 20),
});
