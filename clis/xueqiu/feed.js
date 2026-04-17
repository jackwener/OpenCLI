import { cli } from '@jackwener/opencli/registry';
import { fetchXueqiuJson } from './utils.js';
function strip(html) {
    return (html || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
}
cli({
    site: 'xueqiu',
    name: 'feed',
    description: '获取雪球首页时间线（关注用户的动态）',
    domain: 'xueqiu.com',
    browser: true,
    args: [
        { name: 'page', type: 'int', default: 1, help: '页码，默认 1' },
        { name: 'limit', type: 'int', default: 20, help: '每页数量，默认 20' },
    ],
    columns: ['author', 'text', 'likes', 'replies', 'url'],
    func: async (page, kwargs) => {
        await page.goto('https://xueqiu.com');
        const url = `https://xueqiu.com/v4/statuses/home_timeline.json?page=${kwargs.page}&count=${kwargs.limit}`;
        const d = await fetchXueqiuJson(page, url);
        return (d.home_timeline || d.list || []).slice(0, kwargs.limit).map((item) => {
            const user = item.user || {};
            return {
                author: user.screen_name,
                text: strip(item.description).substring(0, 200),
                likes: item.fav_count,
                replies: item.reply_count,
                url: 'https://xueqiu.com/' + user.id + '/' + item.id,
            };
        });
    },
});
