import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildSubstackBrowseUrl, loadSubstackFeed } from './utils.js';

cli({
  site: 'substack',
  name: 'feed',
  description: 'Substack 热门文章 Feed',
  domain: 'substack.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'category', default: 'all', help: '文章分类: all, tech, business, culture, politics, science, health' },
    { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
  ],
  columns: ['rank', 'title', 'author', 'date', 'readTime', 'url'],
  func: async (page, args) => loadSubstackFeed(page, buildSubstackBrowseUrl(args.category), Number(args.limit) || 20),
});
