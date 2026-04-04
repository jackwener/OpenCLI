import { cli, Strategy } from '../../registry.js';
import { JikePost, getPostDataJs } from './utils.js';

/**
 * 即刻首页动态流适配器
 *
 * 策略：导航到 web.okjike.com/following（需登录），
 * 通过 React fiber 树提取帖子数据。
 */

cli({
  site: 'jike',
  name: 'feed',
  description: '即刻首页动态流',
  domain: 'web.okjike.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20 },
  ],
  columns: ['author', 'content', 'likes', 'comments', 'time', 'url'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;

    // 1. 导航到即刻首页，等待 SPA 重定向到 /following
    await page.goto('https://web.okjike.com');

    // 2. 通过 React fiber 提取帖子数据
    const extract = async (): Promise<JikePost[]> => {
      return (await page.evaluate(`(() => {
        ${getPostDataJs}

        const results = [];
        const seen = new Set();
        const elements = document.querySelectorAll('[class*="_post_"]');

        for (const el of elements) {
          const data = getPostData(el);
          if (!data || !data.id || seen.has(data.id)) continue;
          seen.add(data.id);

          // 转发帖的正文可能为空，取 target（原帖）的内容作 fallback
          const author = data.user?.screenName || data.target?.user?.screenName || '';
          const content = data.content || data.target?.content || '';

          // 跳过无内容且无作者的条目（如 PERSONAL_UPDATE）
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
      })()`)) as JikePost[];
    };

    let posts = await extract();

    // 3. 如果数量不足，自动滚动加载更多
    if (posts.length < limit) {
      await page.autoScroll({ times: Math.ceil(limit / 10), delayMs: 2000 });
      posts = await extract();
    }

    return posts.slice(0, limit);
  },
});
