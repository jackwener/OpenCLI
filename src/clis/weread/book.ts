import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { fetchPrivateApi } from './utils.js';

cli({
  site: 'weread',
  name: 'book',
  description: 'View book details on WeRead',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'book-id', positional: true, required: true, help: 'Book ID (numeric, from search or shelf results)' },
  ],
  columns: ['title', 'author', 'publisher', 'intro', 'category', 'rating'],
  func: async (page: IPage, args) => {
    const data = await fetchPrivateApi(page, '/book/info', { bookId: args['book-id'] });
    // newRating is 0-1000 scale per community docs; needs runtime verification
    const rating = data.newRating ? `${(data.newRating / 10).toFixed(1)}%` : '-';
    return [{
      title: data.title ?? '',
      author: data.author ?? '',
      publisher: data.publisher ?? '',
      intro: data.intro ?? '',
      category: data.category ?? '',
      rating,
    }];
  },
});
