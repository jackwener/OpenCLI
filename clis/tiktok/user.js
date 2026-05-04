import { cli } from '@jackwener/opencli/registry';
cli({
    site: 'tiktok',
    name: 'user',
    access: 'read',
    description: 'Get recent videos from a TikTok user',
    domain: 'www.tiktok.com',
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'TikTok username (without @)',
        },
        { name: 'limit', type: 'int', default: 10, help: 'Number of videos' },
    ],
    columns: ['index', 'views', 'url'],
    pipeline: [
        { navigate: { url: 'https://www.tiktok.com/@${{ args.username }}', settleMs: 6000 } },
        { evaluate: `(() => {
  const limit = \${{ args.limit }};
  const username = \${{ args.username | json }};
  const links = Array.from(document.querySelectorAll('a[href*="/video/"]'));
  const seen = {};
  const results = [];
  for (const a of links) {
    const href = a.href;
    if (seen[href]) continue;
    seen[href] = true;
    results.push({
      index: results.length + 1,
      views: a.textContent.trim() || '-',
      url: href,
    });
    if (results.length >= limit) break;
  }
  if (results.length === 0) throw new Error('No videos found for @' + username);
  return results;
})()
` },
    ],
});
