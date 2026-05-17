import { cli } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
cli({
    site: 'jike',
    name: 'post',
    access: 'read',
    description: '即刻帖子详情及评论',
    domain: 'm.okjike.com',
    browser: true,
    args: [
        {
            name: 'id',
            type: 'string',
            required: true,
            positional: true,
            help: 'Post ID (from post URL)',
        },
    ],
    columns: ['type', 'author', 'content', 'likes', 'time'],
    func: async (page, args) => {
        await page.goto(`https://m.okjike.com/originalPosts/${args.id}`);
        const data = await page.evaluate(`(() => {
  const el = document.querySelector('script[type="application/json"]');
  if (!el) return { ok: false, reason: 'missing-data-script' };
  try {
    const data = JSON.parse(el.textContent || '{}');
    const pageProps = data?.props?.pageProps || {};
    const post = pageProps.post || {};
    const comments = Array.isArray(pageProps.comments) ? pageProps.comments : [];

    const result = [{
      type: 'post',
      author: post.user?.screenName || '',
      content: post.content || '',
      likes: post.likeCount || 0,
      time: post.createdAt || '',
    }];

    for (const c of comments) {
      result.push({
        type: 'comment',
        author: c.user?.screenName || '',
        content: (c.content || '').replace(/\\n/g, ' '),
        likes: c.likeCount || 0,
        time: c.createdAt || '',
      });
    }

    return result;
  } catch (e) {
    return { ok: false, reason: 'parse-error', message: e?.message || String(e) };
  }
})()
`);
        if (Array.isArray(data)) {
            return data.map((item) => ({
                type: item.type ?? '',
                author: item.author ?? '',
                content: item.content ?? '',
                likes: item.likes ?? 0,
                time: item.time ?? '',
            }));
        }
        if (data?.reason === 'missing-data-script') {
            throw new CommandExecutionError('Jike post page did not expose the expected data script');
        }
        if (data?.reason === 'parse-error') {
            throw new CommandExecutionError(`Failed to parse Jike post data: ${data.message || 'unknown error'}`);
        }
        throw new CommandExecutionError('Jike post returned an unreadable payload');
    },
});
