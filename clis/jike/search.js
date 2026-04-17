import { cli, Strategy } from '@jackwener/opencli/registry';
import { getPostDataJs } from './utils.js';
/**
 * 即刻搜索适配器
 *
 * 策略：直接导航到 web.okjike.com 搜索页，
 * 通过 React fiber 树提取帖子数据。
 */
cli({
    site: 'jike',
    name: 'search',
    description: '搜索即刻帖子',
    domain: 'web.okjike.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true },
        { name: 'limit', type: 'int', default: 20 },
    ],
    columns: ['author', 'content', 'likes', 'comments', 'time', 'url'],
    func: async (page, kwargs) => {
        const keyword = kwargs.query;
        const limit = kwargs.limit || 20;
        // 1. 直接导航到搜索页
        const encodedKeyword = encodeURIComponent(keyword);
        await page.goto(`https://web.okjike.com/search?q=${encodedKeyword}`);
        // 2. 通过 React fiber 提取帖子数据
        const extract = async () => {
            return (await page.evaluate(`(() => {
        ${getPostDataJs}

        const results = [];
        const seen = new Set();
        const elements = document.querySelectorAll('[class*="_post_"], [class*="_postItem_"]');

        for (const el of elements) {
          const data = getPostData(el);
          if (!data || !data.id || seen.has(data.id)) continue;
          seen.add(data.id);

          const author = data.user?.screenName || data.target?.user?.screenName || '';
          const content = data.content || data.target?.content || '';
          if (!author && !content) continue;

          results.push({
            author,
            content: content.replace(/\\n/g, ' ').slice(0, 120),
            likes: data.likeCount || 0,
            comments: data.commentCount || 0,
            time: data.actionTime || data.createdAt || '',
            url: 'https://web.okjike.com/originalPost/' + data.id,
          });
        }

        return results;
      })()`));
        };
        let posts = await extract();
        // 3. 数量不足时自动滚动加载更多
        if (posts.length < limit) {
            await page.autoScroll({ times: Math.ceil(limit / 10), delayMs: 2000 });
            posts = await extract();
        }
        return posts.slice(0, limit);
    },
});
