import { cli } from '@jackwener/opencli/registry';
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
    pipeline: [
        { navigate: 'https://m.okjike.com/users/${{ args.username }}' },
        { evaluate: `(() => {
  try {
    const el = document.querySelector('script[type="application/json"]');
    if (!el) return [];
    const data = JSON.parse(el.textContent);
    const posts = data?.props?.pageProps?.posts || [];
    return posts.map(p => ({
      content: (p.content || '').replace(/\\n/g, ' ').slice(0, 80),
      type: p.type === 'ORIGINAL_POST' ? 'post' : p.type === 'REPOST' ? 'repost' : p.type || '',
      likes: p.likeCount || 0,
      comments: p.commentCount || 0,
      time: p.actionTime || p.createdAt || '',
      id: p.id || '',
    }));
  } catch (e) {
    return [];
  }
})()
` },
        { map: {
                id: '${{ item.id }}',
                content: '${{ item.content }}',
                type: '${{ item.type }}',
                likes: '${{ item.likes }}',
                comments: '${{ item.comments }}',
                time: '${{ item.time }}',
                url: 'https://web.okjike.com/originalPost/${{ item.id }}',
            } },
        { limit: '${{ args.limit }}' },
    ],
});
