import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'douban',
    name: 'top250',
    access: 'read',
    description: '豆瓣电影 Top250',
    domain: 'movie.douban.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 250, help: '返回结果数量' },
    ],
    columns: ['rank', 'id', 'title', 'rating', 'url'],
    pipeline: [
        { navigate: 'https://movie.douban.com/top250' },
        { evaluate: `async () => {
  const results = [];
  const limit = \${{ args.limit }};

  const parsePage = (doc) => {
    const items = doc.querySelectorAll('.item');
    for (const item of items) {
      if (results.length >= limit) break;

      const rankEl = item.querySelector('.pic em');
      const linkEl = item.querySelector('a');
      const titleEl = item.querySelector('.title');
      const ratingEl = item.querySelector('.rating_num');

      const href = linkEl?.href || '';
      const matchResult = href.match(/subject\\/(\\d+)/);
      const id = matchResult ? matchResult[1] : '';

      const title = titleEl?.textContent?.trim() || '';
      const rank = parseInt(rankEl?.textContent || '0', 10);
      const rating = ratingEl?.textContent?.trim() || '';

      if (id && title) {
        results.push({
          rank: rank || results.length + 1,
          id,
          title,
          rating: rating ? parseFloat(rating) : 0,
          url: href
        });
      }
    }
  };

  parsePage(document);

  for (let start = 25; start < 250 && results.length < limit; start += 25) {
    const resp = await fetch(\`https://movie.douban.com/top250?start=\${start}\`);
    if (!resp.ok) break;
    const html = await resp.text();
    if (!html) break;

    const doc = new DOMParser().parseFromString(html, 'text/html');
    parsePage(doc);
    await new Promise(r => setTimeout(r, 150));
  }

  return results;
}
` },
        { limit: '${{ args.limit }}' },
    ],
});
