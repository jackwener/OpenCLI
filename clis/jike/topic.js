import { cli } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
cli({
    site: 'jike',
    name: 'topic',
    access: 'read',
    description: '即刻话题/圈子帖子',
    domain: 'm.okjike.com',
    browser: true,
    args: [
        {
            name: 'id',
            type: 'string',
            required: true,
            positional: true,
            help: 'Topic ID (from topic URL, e.g. 553870e8e4b0cafb0a1bef68)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['content', 'author', 'likes', 'comments', 'time', 'url'],
    func: async (page, args) => {
        await page.goto(`https://m.okjike.com/topics/${args.id}`);
        const limit = Number(args.limit) || 20;
        const data = await page.evaluate(`(() => {
  const el = document.querySelector('script[type="application/json"]');
  if (!el) return { ok: false, reason: 'missing-data-script' };
  try {
    const data = JSON.parse(el.textContent || '{}');
    const pageProps = data?.props?.pageProps || {};
    const posts = Array.isArray(pageProps.posts) ? pageProps.posts : [];
    return posts.map(p => ({
      content: (p.content || '').replace(/\\n/g, ' ').slice(0, 80),
      author: p.user?.screenName || '',
      likes: p.likeCount || 0,
      comments: p.commentCount || 0,
      time: p.actionTime || p.createdAt || '',
      id: p.id || '',
    }));
  } catch (e) {
    return { ok: false, reason: 'parse-error', message: e?.message || String(e) };
  }
})()
`);
        if (Array.isArray(data)) {
            if (data.length === 0) {
                throw new EmptyResultError('jike topic', `No posts were returned for topic ${args.id}. Confirm the topic ID and login state.`);
            }
            return data.slice(0, limit).map((item) => ({
                content: item.content ?? '',
                author: item.author ?? '',
                likes: item.likes ?? 0,
                comments: item.comments ?? 0,
                time: item.time ?? '',
                url: `https://web.okjike.com/originalPost/${item.id ?? ''}`,
            }));
        }
        if (data?.reason === 'missing-data-script') {
            throw new CommandExecutionError('Jike topic page did not expose the expected data script');
        }
        if (data?.reason === 'parse-error') {
            throw new CommandExecutionError(`Failed to parse Jike topic data: ${data.message || 'unknown error'}`);
        }
        throw new CommandExecutionError('Jike topic returned an unreadable payload');
    },
});
