import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildLinuxDoCompatFooter, executeLinuxDoFeed } from './feed.js';
cli({
    site: 'linux-do',
    name: 'latest',
    access: 'read',
    description: 'linux.do 最新话题',
    domain: 'linux.do',
    strategy: Strategy.COOKIE,
    browser: true,
    columns: ['title', 'replies', 'created', 'likes', 'views', 'url'],
    deprecated: 'opencli linux-do latest is kept for backward compatibility.',
    replacedBy: 'opencli linux-do feed --view latest',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items (per_page)' },
    ],
    func: async (page, kwargs) => executeLinuxDoFeed(page, { ...kwargs, view: 'latest' }),
    footerExtra: () => buildLinuxDoCompatFooter('opencli linux-do feed --view latest'),
});
