import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'tiktok',
  name: 'explore',
  description: 'Get trending TikTok videos from explore page',
  domain: 'www.tiktok.com',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of videos' },
  ],
  columns: ['rank', 'author', 'views', 'url'],
  pipeline: [
    { navigate: { url: 'https://www.tiktok.com/explore', settleMs: 5000 } },
    { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
  const seen = new Set();
  const results = [];
  for (const a of links) {
    const href = a.href;
    if (seen.has(href)) continue;
    seen.add(href);
    const match = href.match(/@([^/]+)\\/video\\/(\\d+)/);
    results.push({
      rank: results.length + 1,
      author: match ? match[1] : '',
      views: a.textContent.trim() || '-',
      url: href,
    });
    if (results.length >= limit) break;
  }
  return results;
})()
` },
  ],
});
