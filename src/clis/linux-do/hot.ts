import { cli, Strategy } from '../../registry.js';
import { buildLinuxDoCompatFooter, executeLinuxDoFeed } from './feed.js';

cli({
  site: 'linux-do',
  name: 'hot',
  description: 'linux.do 热门话题',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  columns: ['title', 'replies', 'created', 'likes', 'views', 'url'],
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of items (per_page)' },
    {
      name: 'period',
      type: 'str',
      default: 'weekly',
      help: 'Time period',
      choices: ['all', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'],
    },
  ],
  func: async (page, kwargs) => executeLinuxDoFeed(page, { ...kwargs, view: 'top' }),
  footerExtra: () => buildLinuxDoCompatFooter('opencli linux-do feed --view top --period <period>'),
});
