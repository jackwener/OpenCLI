import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';
import { fetchPrivateApi, formatDate } from './utils.js';

cli({
  site: 'weread',
  name: 'notes',
  description: 'List your notes (thoughts) on a book',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'book-id', positional: true, required: true, help: 'Book ID (from shelf or search results)' },
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['chapter', 'text', 'review', 'createTime'],
  func: async (page: IPage, args) => {
    const data = await fetchPrivateApi(page, '/review/list', {
      bookId: args['book-id'],
      listType: '11',
      mine: '1',
      synckey: '0',
    });
    const items: any[] = data?.reviews ?? [];
    return items.slice(0, Number(args.limit)).map((item: any) => ({
      chapter: item.review?.chapterName ?? '',
      text: item.review?.abstract ?? '',
      review: item.review?.content ?? '',
      createTime: formatDate(item.review?.createTime),
    }));
  },
});
