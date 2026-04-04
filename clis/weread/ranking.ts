import { cli, Strategy } from '../../src/registry.js';
import { fetchWebApi } from './utils.js';

cli({
  site: 'weread',
  name: 'ranking',
  description: 'WeRead book rankings by category',
  domain: 'weread.qq.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'category', positional: true, default: 'all', help: 'Category: all (default), rising, or numeric category ID' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['rank', 'title', 'author', 'category', 'readingCount', 'bookId'],
  func: async (_page, args) => {
    const cat = encodeURIComponent(args.category ?? 'all');
    const data = await fetchWebApi(`/bookListInCategory/${cat}`, { rank: '1' });
    const books: any[] = data?.books ?? [];
    return books.slice(0, Number(args.limit)).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.bookInfo?.title ?? '',
      author: item.bookInfo?.author ?? '',
      category: item.bookInfo?.category ?? '',
      readingCount: item.readingCount ?? 0,
      bookId: item.bookInfo?.bookId ?? '',
    }));
  },
});
