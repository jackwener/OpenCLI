import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadDoubanComments, normalizeDoubanSubjectId } from './utils.js';

cli({
    site: 'douban',
    name: 'comments',
    access: 'read',
    description: '获取豆瓣条目短评',
    domain: 'movie.douban.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'id', positional: true, required: true, help: '豆瓣条目 ID' },
        { name: 'type', default: 'movie', choices: ['movie', 'book', 'music'], help: '条目类型（movie=电影, book=图书, music=音乐）' },
        { name: 'limit', type: 'int', default: 100, help: '最多返回多少条短评' },
        { name: 'sort', default: 'new_score', choices: ['new_score', 'time'], help: '排序方式（new_score=热门, time=最新）' },
    ],
    columns: ['index', 'id', 'userName', 'rating', 'ratingText', 'votes', 'time', 'content', 'url'],
    func: async (page, kwargs) => loadDoubanComments(page, normalizeDoubanSubjectId(String(kwargs.id || '')), {
        type: String(kwargs.type || 'movie'),
        limit: Number(kwargs.limit) || 100,
        sort: String(kwargs.sort || 'new_score'),
    }),
});
