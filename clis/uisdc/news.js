/**
 * uisdc news adapter
 *
 * Fetches the latest AI/design industry news from 优设读报 (uisdc.com/news).
 * Uses browser scraping via CSS selectors on the news list.
 *
 * Usage:
 *   opencli uisdc news
 *   opencli uisdc news --limit 10
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'uisdc',
  name: 'news',
  description: '优设读报 - 最新 AI/设计行业新闻',
  domain: 'www.uisdc.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of news items to return' },
  ],
  columns: ['rank', 'title', 'summary'],
  pipeline: [
    { navigate: 'https://www.uisdc.com/news' },
    {
      evaluate: `
        const items = Array.from(
          document.querySelectorAll(
            '.news-list > .news-item:first-child > .item-content > .dubao-items > .dubao-item'
          )
        );
        return items.map((el, i) => ({
          rank: i + 1,
          title: el.querySelector('.dubao-title')?.textContent?.trim() ?? '',
          summary: el.querySelector('.dubao-content')?.textContent?.trim() ?? '',
          url: el.querySelector('a')?.href ?? '',
        }));
      `,
    },
    { limit: '${{ args.limit }}' },
  ],
});
