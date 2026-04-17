import { cli, Strategy } from '@jackwener/opencli/registry';
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
    func: async (page, args) => {
        const data = await fetchPrivateApi(page, '/book/bookmarklist', { bookId: args['book-id'] });
        const items = data?.updated ?? [];
        return items.slice(0, Number(args.limit)).map((item) => ({
            chapter: item.chapterName ?? '',
            text: item.markText ?? '',
            createTime: formatDate(item.createTime),
        }));
    },
});
