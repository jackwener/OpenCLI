import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'search',
    description: 'Search Facebook for people, pages, or posts',
    domain: 'www.facebook.com',
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['index', 'title', 'text', 'url'],
    pipeline: [
        { navigate: 'https://www.facebook.com' },
        { navigate: { url: 'https://www.facebook.com/search/top?q=${{ args.query | urlencode }}', settleMs: 4000 } },
        { evaluate: `(async () => {
  const limit = \${{ args.limit }};
  // Search results are typically in role="article" or role="listitem"
  let items = document.querySelectorAll('[role="article"]');
  if (items.length === 0) {
    items = document.querySelectorAll('[role="listitem"]');
  }
  return Array.from(items)
    .filter(el => el.textContent.trim().length > 20)
    .slice(0, limit)
    .map((el, i) => {
      const link = el.querySelector('a[href*="facebook.com/"]');
      const heading = el.querySelector('h2, h3, h4, strong');
      return {
        index: i + 1,
        title: heading ? heading.textContent.trim().substring(0, 80) : '',
        text: el.textContent.trim().replace(/\\s+/g, ' ').substring(0, 150),
        url: link ? link.href.split('?')[0] : '',
      };
    });
})()
` },
    ],
});
