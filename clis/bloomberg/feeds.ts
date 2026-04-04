import { cli, Strategy } from '../../registry.js';
import { BLOOMBERG_FEEDS } from './utils.js';

cli({
  site: 'bloomberg',
  name: 'feeds',
  description: 'List the Bloomberg RSS feed aliases used by the adapter',
  domain: 'feeds.bloomberg.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['name', 'url'],
  func: async () => {
    return Object.entries(BLOOMBERG_FEEDS).map(([name, url]) => ({ name, url }));
  },
});
