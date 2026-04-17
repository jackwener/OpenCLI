import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadDoubanMovieHot } from './utils.js';
cli({
    site: 'douban',
    name: 'movie-hot',
    description: '豆瓣电影热门榜单',
    domain: 'movie.douban.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: '返回的电影数量' },
    ],
    columns: ['rank', 'title', 'rating', 'quote', 'director', 'year', 'region', 'url'],
    func: async (page, args) => loadDoubanMovieHot(page, Number(args.limit) || 20),
});
