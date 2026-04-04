import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { fetchPrivateApi, formatDate } from './utils.js';

cli({
  site: 'weread',
  name: 'highlights',
  description: 'List your highlights (underlines) in a book',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'book-id', positional: true, required: true, help: 'Book ID (from shelf or search results)' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['chapter', 'text', 'createTime'],
  func: async (page: IPage, args) => {
    const data = await fetchPrivateApi(page, '/book/bookmarklist', { bookId: args['book-id'] });
    const items: any[] = data?.updated ?? [];
    return items.slice(0, Number(args.limit)).map((item: any) => ({
      chapter: item.chapterName ?? '',
      text: item.markText ?? '',
      createTime: formatDate(item.createTime),
    }));
  },
});
