import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchBloombergFeed } from './utils.js';
cli({
    site: 'bloomberg',
    name: 'markets',
    access: 'read',
    description: 'Bloomberg Markets top stories (RSS)',
    domain: 'feeds.bloomberg.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 1, help: 'Number of feed items to return (max 20)' },
    ],
    columns: ['title', 'summary', 'link', 'mediaLinks'],
    func: async (kwargs) => {
        return fetchBloombergFeed('markets', kwargs.limit ?? 1);
    },
});
