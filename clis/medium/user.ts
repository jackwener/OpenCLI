import { cli, Strategy } from '../../src/registry.js';
import { buildMediumUserUrl, loadMediumPosts } from './utils.js';

cli({
  site: 'medium',
  name: 'user',
  description: '获取 Medium 用户的文章列表',
  domain: 'medium.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', required: true, positional: true, help: 'Medium 用户名（如 @username 或 username）' },
    { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
  ],
  columns: ['rank', 'title', 'date', 'readTime', 'claps', 'url'],
  func: async (page, args) => loadMediumPosts(page, buildMediumUserUrl(args.username), Number(args.limit) || 20),
});
