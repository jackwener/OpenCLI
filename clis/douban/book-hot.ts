import { cli, Strategy } from '../../src/registry.js';
import { loadDoubanBookHot } from './utils.js';

cli({
  site: 'douban',
  name: 'book-hot',
  description: '豆瓣图书热门榜单',
  domain: 'book.douban.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回的图书数量' },
  ],
  columns: ['rank', 'title', 'rating', 'quote', 'author', 'publisher', 'year', 'url'],
  func: async (page, args) => loadDoubanBookHot(page, Number(args.limit) || 20),
});
