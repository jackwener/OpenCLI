import { cli, Strategy } from '@jackwener/opencli/registry';
import { searchDouban } from './utils.js';
cli({
    site: 'douban',
    name: 'search',
    access: 'read',
    description: '搜索豆瓣电影、图书或音乐',
    domain: 'search.douban.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'type', default: 'movie', choices: ['movie', 'book', 'music'], help: '搜索类型（movie=电影, book=图书, music=音乐）' },
        { name: 'keyword', required: true, positional: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 20, help: '返回结果数量' },
    ],
    columns: ['rank', 'title', 'rating', 'abstract', 'url'],
    func: async (page, args) => searchDouban(page, args.type, args.keyword, Number(args.limit) || 20),
});
