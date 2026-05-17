import { cli } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
cli({
    site: 'jike',
    name: 'user',
    access: 'read',
    description: '即刻用户动态',
    domain: 'm.okjike.com',
    browser: true,
    args: [
        {
            name: 'username',
            type: 'string',
            required: true,
            positional: true,
            help: 'Username from profile URL (e.g. wenhao1996)',
        },
        { name: 'limit', type: 'int', default: 20, help: 'Number of posts' },
    ],
    columns: ['id', 'content', 'type', 'likes', 'comments', 'time', 'url'],
    func: async (page, args) => {
        await page.goto(`https://m.okjike.com/users/${args.username}`);
        const limit = Number(args.limit) || 20;
        const data = await page.evaluate(`(() => {
  const el = document.querySelector('script[type="application/json"]');
  if (!el) return { ok: false, reason: 'missing-data-script' };
  try {
    const data = JSON.parse(el.textContent || '{}');
    const posts = Array.isArray(data?.props?.pageProps?.posts) ? data.props.pageProps.posts : [];
    return posts.map(p => ({
      content: (p.content || '').replace(/\\n/g, ' ').slice(0, 80),
      type: p.type === 'ORIGINAL_POST' ? 'post' : p.type === 'REPOST' ? 'repost' : p.type || '',
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
                throw new EmptyResultError('jike user', `No posts were returned for user ${args.username}. Confirm the username and login state.`);
            }
            return data.slice(0, limit).map((item) => ({
                id: item.id ?? '',
                content: item.content ?? '',
                type: item.type ?? '',
                likes: item.likes ?? 0,
                comments: item.comments ?? 0,
                time: item.time ?? '',
                url: `https://web.okjike.com/originalPost/${item.id ?? ''}`,
            }));
        }
        if (data?.reason === 'missing-data-script') {
            throw new CommandExecutionError('Jike user page did not expose the expected data script');
        }
        if (data?.reason === 'parse-error') {
            throw new CommandExecutionError(`Failed to parse Jike user data: ${data.message || 'unknown error'}`);
        }
        throw new CommandExecutionError('Jike user returned an unreadable payload');
    },
});
