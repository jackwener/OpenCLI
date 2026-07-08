import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'memories',
    access: 'read',
    description: 'Get your Facebook memories (On This Day)',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 10, help: 'Number of memories' },
    ],
    columns: ['index', 'source', 'content', 'time'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/onthisday', settleMs: 4000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const articles = document.querySelectorAll('[role="article"]');
  return Array.from(articles)
    .slice(0, limit)
    .map((el, i) => {
      const headerLink = el.querySelector('h2 a, h3 a, h4 a, strong a');
      const spans = Array.from(el.querySelectorAll('div[dir="auto"]'))
        .map(s => s.textContent.trim())
        .filter(t => t.length > 5 && t.length < 500);
      const timeEl = el.querySelector('a[href*="/posts/"] span, a[href*="story_fbid"] span');
      return {
        index: i + 1,
        source: headerLink ? headerLink.textContent.trim().substring(0, 50) : '-',
        content: (spans[0] || '').replace(/\\n/g, ' ').substring(0, 150),
        time: timeEl ? timeEl.textContent.trim() : '-',
      };
    })
    .filter(item => item.content.length > 0 || item.source !== '-');
})()
` },
    ],
});
