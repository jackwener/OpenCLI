import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { fetchPrivateApi } from './utils.js';

cli({
  site: 'weread',
  name: 'notebooks',
  description: 'List books that have highlights or notes',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  columns: ['title', 'author', 'noteCount', 'bookId'],
  func: async (page: IPage, _args) => {
    const data = await fetchPrivateApi(page, '/user/notebooks');
    const books: any[] = data?.books ?? [];
    return books.map((item: any) => ({
      title: item.book?.title ?? '',
      author: item.book?.author ?? '',
      // TODO: bookmarkCount/reviewCount field names from community docs, verify with real API
      noteCount: (item.bookmarkCount ?? 0) + (item.reviewCount ?? 0),
      bookId: item.bookId ?? '',
    }));
  },
});
