import { cli, Strategy } from '../../registry.js';
import { loadSinaBlogHot } from './shared.js';

cli({
  site: 'sinablog',
  name: 'hot',
  description: '获取新浪博客热门文章/推荐',
  domain: 'blog.sina.com.cn',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回的文章数量' },
  ],
  columns: ['rank', 'title', 'author', 'date', 'readCount', 'url'],
  func: async (page, args) => loadSinaBlogHot(page, Number(args.limit) || 20),
});
