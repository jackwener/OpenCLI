import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'events',
    description: 'Browse Facebook event categories',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 15, help: 'Number of categories' },
    ],
    columns: ['index', 'name'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/events', settleMs: 3000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  // Try actual event items first
  const articles = document.querySelectorAll('[role="article"]');
  if (articles.length > 0) {
    return Array.from(articles).slice(0, limit).map((el, i) => ({
      index: i + 1,
      name: el.textContent.trim().replace(/\\s+/g, ' ').substring(0, 120),
    }));
  }

  // List event categories from sidebar navigation
  const links = Array.from(document.querySelectorAll('[role="navigation"] a'))
    .filter(a => {
      const href = a.href || '';
      const text = a.textContent.trim();
      return href.includes('/events/') && text.length > 1 && text.length < 60 &&
        !href.includes('create');
    });

  return links.slice(0, limit).map((a, i) => ({
    index: i + 1,
    name: a.textContent.trim(),
  }));
})()
` },
    ],
});
