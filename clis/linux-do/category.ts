import { cli, Strategy } from '../../src/registry.js';
import { buildLinuxDoCompatFooter, executeLinuxDoFeed } from './feed.js';

cli({
  site: 'linux-do',
  name: 'category',
  description: 'linux.do 分类内话题',
  domain: 'linux.do',
  strategy: Strategy.COOKIE,
  browser: true,
  columns: ['title', 'replies', 'created', 'likes', 'views', 'url'],
  deprecated: 'opencli linux-do category is kept for backward compatibility.',
  replacedBy: 'opencli linux-do feed --category <id-or-name>',
  args: [
    {
      name: 'slug',
      positional: true,
      type: 'str',
      required: true,
      help: 'Category slug (legacy compatibility argument)',
    },
    {
      name: 'id',
      positional: true,
      type: 'int',
      required: true,
      help: 'Category ID',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Number of items (per_page)' },
  ],
  func: async (page, kwargs) => executeLinuxDoFeed(page, {
    limit: kwargs.limit,
    category: String(kwargs.id),
    view: 'latest',
  }),
  footerExtra: (kwargs) => buildLinuxDoCompatFooter(`opencli linux-do feed --category ${kwargs.id ?? '<id>'}`),
});
