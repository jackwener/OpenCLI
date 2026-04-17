import { cli, Strategy } from '@jackwener/opencli/registry';
import { loadSinaBlogArticle } from './utils.js';
cli({
    site: 'sinablog',
    name: 'article',
    description: '获取新浪博客单篇文章详情',
    domain: 'blog.sina.com.cn',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: '文章URL（如 https://blog.sina.com.cn/s/blog_xxx.html）' },
    ],
    columns: ['title', 'author', 'date', 'category', 'readCount', 'commentCount'],
    func: async (page, args) => loadSinaBlogArticle(page, args.url),
});
