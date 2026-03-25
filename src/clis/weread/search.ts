import { cli, Strategy } from '../../registry.js';
import { fetchWebApi } from './utils.js';

cli({
  site: 'weread',
  name: 'search',
  description: 'Search books on WeRead',
  domain: 'weread.qq.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['rank', 'title', 'author', 'bookId', 'url'],
  func: async (_page, args) => {
    const data = await fetchWebApi('/search/global', { keyword: args.keyword });
    const books: any[] = data?.books ?? [];
    return books.slice(0, Number(args.limit)).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.bookInfo?.title ?? '',
      author: item.bookInfo?.author ?? '',
      bookId: item.bookInfo?.bookId ?? '',
      url: item.bookInfo?.bookId ? 'https://weread.qq.com/web/bookDetail/' + item.bookInfo.bookId : '',
    }));
  },
});
