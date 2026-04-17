import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'facebook',
    name: 'groups',
    description: 'List your Facebook groups',
    domain: 'www.facebook.com',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of groups' },
    ],
    columns: ['index', 'name', 'last_post', 'url'],
    pipeline: [
        { navigate: { url: 'https://www.facebook.com/groups/feed/', settleMs: 3000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const links = Array.from(document.querySelectorAll('a'))
    .filter(a => {
      const href = a.href || '';
      return href.includes('/groups/') &&
        !href.includes('/feed') &&
        !href.includes('/discover') &&
        !href.includes('/joins') &&
        !href.includes('category=create') &&
        a.textContent.trim().length > 2;
    });

  // Deduplicate by href
  const seen = new Set();
  const groups = [];
  for (const a of links) {
    const href = a.href.split('?')[0];
    if (seen.has(href)) continue;
    seen.add(href);
    const raw = a.textContent.trim().replace(/\\s+/g, ' ');
    // Split name from "上次发帖" info
    const parts = raw.split(/上次发帖|Last post/);
    groups.push({
      name: (parts[0] || '').trim().substring(0, 60),
      last_post: parts[1] ? parts[1].replace(/^[：:]/, '').trim() : '-',
      url: href,
    });
  }
  return groups.slice(0, limit).map((g, i) => ({ index: i + 1, ...g }));
})()
` },
    ],
});
