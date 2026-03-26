import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { fetchPrivateApi } from './utils.js';

cli({
  site: 'weread',
  name: 'shelf',
  description: 'List books on your WeRead bookshelf',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['title', 'author', 'progress', 'bookId'],
  func: async (page: IPage, args) => {
    const data = await fetchPrivateApi(page, '/shelf/sync', { synckey: '0', lectureSynckey: '0' });
    const books: any[] = data?.books ?? [];
    return books.slice(0, Number(args.limit)).map((item: any) => ({
      title: item.bookInfo?.title ?? item.title ?? '',
      author: item.bookInfo?.author ?? item.author ?? '',
      // TODO: readingProgress field name from community docs, verify with real API response
      progress: item.readingProgress != null ? `${item.readingProgress}%` : '-',
      bookId: item.bookId ?? item.bookInfo?.bookId ?? '',
    }));
  },
});
