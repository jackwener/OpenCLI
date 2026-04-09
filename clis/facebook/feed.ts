import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'facebook',
  name: 'feed',
  description: 'Get your Facebook news feed',
  domain: 'www.facebook.com',
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of posts' },
  ],
  columns: ['index', 'author', 'content', 'likes', 'comments', 'shares'],
  pipeline: [
    { navigate: { url: 'https://www.facebook.com/', settleMs: 4000 } },
    { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const posts = document.querySelectorAll('[role="article"]');
  return Array.from(posts)
    .filter(el => {
      const text = el.textContent.trim();
      // Filter out "People you may know" suggestions (both CN and EN)
      return text.length > 30 &&
        !text.startsWith('可能认识') &&
        !text.startsWith('People you may know') &&
        !text.startsWith('People You May Know');
    })
    .slice(0, limit)
    .map((el, i) => {
      // Author from header link
      const headerLink = el.querySelector('h2 a, h3 a, h4 a, strong a');
      const author = headerLink ? headerLink.textContent.trim() : '';

      // Post text: grab visible spans, filter noise
      const spans = Array.from(el.querySelectorAll('div[dir="auto"]'))
        .map(s => s.textContent.trim())
        .filter(t => t.length > 10 && t.length < 500);
      const content = spans.length > 0 ? spans[0] : '';

      // Engagement: find like/comment/share counts (CN + EN)
      const allText = el.textContent;
      const likesMatch = allText.match(/所有心情：([\\d,.\\s]*[\\d万亿KMk]+)/) ||
                         allText.match(/All:\\s*([\\d,.KMk]+)/) ||
                         allText.match(/([\\d,.KMk]+)\\s*(?:likes?|reactions?)/i);
      const commentsMatch = allText.match(/([\\d,.]+\\s*[万亿]?)\\s*条评论/) ||
                            allText.match(/([\\d,.KMk]+)\\s*comments?/i);
      const sharesMatch = allText.match(/([\\d,.]+\\s*[万亿]?)\\s*次分享/) ||
                          allText.match(/([\\d,.KMk]+)\\s*shares?/i);

      return {
        index: i + 1,
        author: author.substring(0, 50),
        content: content.replace(/\\n/g, ' ').substring(0, 120),
        likes: likesMatch ? likesMatch[1] : '-',
        comments: commentsMatch ? commentsMatch[1] : '-',
        shares: sharesMatch ? sharesMatch[1] : '-',
      };
    });
})()
` },
  ],
});
