/**
 * aibase news adapter
 *
 * Fetches the latest AI industry daily news from AIbase (日报).
 * Scrapes article links from aibase.com/zh/daily.
 *
 * Usage:
 *   opencli aibase news
 *   opencli aibase news --limit 10
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'aibase',
  name: 'news',
  description: 'AIbase 日报 - 每天三分钟关注AI行业趋势',
  domain: 'www.aibase.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of news items to return' },
  ],
  columns: ['rank', 'title', 'url'],
  pipeline: [
    { navigate: 'https://www.aibase.com/zh/daily' },
    {
      evaluate: `
        const items = Array.from(
          document.querySelectorAll('.bg-white .grid a')
        ).filter(el => el.href && el.textContent.trim());
        return items.map((el, i) => ({
          rank: i + 1,
          title: el.textContent.trim(),
          url: el.href,
        }));
      `,
    },
    { limit: '${{ args.limit }}' },
  ],
});
