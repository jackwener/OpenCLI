import { cli, Strategy } from '../../registry.js';
import { fetchBloombergFeed } from './utils.js';

cli({
  site: 'bloomberg',
  name: 'politics',
  description: 'Bloomberg Politics top stories (RSS)',
  domain: 'feeds.bloomberg.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 1, help: 'Number of feed items to return (max 20)' },
  ],
  columns: ['title', 'summary', 'link', 'mediaLinks'],
  func: async (_page, kwargs) => {
    return fetchBloombergFeed('politics', kwargs.limit ?? 1);
  },
});
