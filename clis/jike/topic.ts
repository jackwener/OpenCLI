import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'jike',
  name: 'topic',
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
  pipeline: [
    { navigate: 'https://m.okjike.com/topics/${{ args.id }}' },
    { evaluate: `(() => {
  try {
    const el = document.querySelector('script[type="application/json"]');
    if (!el) return [];
    const data = JSON.parse(el.textContent);
    const pageProps = data?.props?.pageProps || {};
    const posts = pageProps.posts || [];
    return posts.map(p => ({
      content: (p.content || '').replace(/\\n/g, ' ').slice(0, 80),
      author: p.user?.screenName || '',
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
        content: '${{ item.content }}',
        author: '${{ item.author }}',
        likes: '${{ item.likes }}',
        comments: '${{ item.comments }}',
        time: '${{ item.time }}',
        url: 'https://web.okjike.com/originalPost/${{ item.id }}',
      } },
    { limit: '${{ args.limit }}' },
  ],
});
