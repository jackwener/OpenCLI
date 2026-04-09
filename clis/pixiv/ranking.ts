import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'pixiv',
  name: 'ranking',
  description: 'Pixiv illustration rankings (daily/weekly/monthly)',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'mode',
      default: 'daily',
      help: 'Ranking mode',
      choices: [
    'daily',
    'weekly',
    'monthly',
    'rookie',
    'original',
    'male',
    'female',
    'daily_r18',
    'weekly_r18',
  ],
    },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'author', 'illust_id', 'pages', 'bookmarks'],
  pipeline: [
    { navigate: 'https://www.pixiv.net' },
    { evaluate: `(async () => {
  const mode = \${{ args.mode | json }};
  const page = \${{ args.page | json }};
  const limit = \${{ args.limit | json }};
  const res = await fetch(
    'https://www.pixiv.net/ranking.php?mode=' + mode + '&p=' + page + '&format=json',
    { credentials: 'include' }
  );
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('Authentication required — please log in to Pixiv in Chrome');
    throw new Error('Pixiv request failed (HTTP ' + res.status + ')');
  }
  const data = await res.json();
  const items = (data?.contents || []).slice(0, limit);
  return items.map((item, i) => ({
    rank: item.rank,
    title: item.title,
    author: item.user_name,
    user_id: item.user_id,
    illust_id: item.illust_id,
    pages: item.illust_page_count,
    bookmarks: item.illust_bookmark_count,
    url: 'https://www.pixiv.net/artworks/' + item.illust_id
  }));
})()
` },
  ],
});
