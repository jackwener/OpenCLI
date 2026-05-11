import { cli } from '@jackwener/opencli/registry';
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
    pipeline: [
        { navigate: 'https://m.okjike.com/originalPosts/${{ args.id }}' },
        { evaluate: `(() => {
  try {
    const el = document.querySelector('script[type="application/json"]');
    if (!el) return [];
    const data = JSON.parse(el.textContent);
    const pageProps = data?.props?.pageProps || {};
    const post = pageProps.post || {};
    const comments = pageProps.comments || [];

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
    return [];
  }
})()
` },
        { map: {
                type: '${{ item.type }}',
                author: '${{ item.author }}',
                content: '${{ item.content }}',
                likes: '${{ item.likes }}',
                time: '${{ item.time }}',
            } },
    ],
});
