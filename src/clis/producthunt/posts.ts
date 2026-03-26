/**
 * Product Hunt latest posts — public Atom feed, no browser needed.
 */
import { cli, Strategy } from '../../registry.js';
import { fetchFeed } from './utils.js';

const CATEGORIES = [
  'ai', 'developer-tools', 'productivity', 'saas', 'design-tools',
  'marketing', 'fintech', 'education', 'health-fitness', 'games',
];

cli({
  site: 'producthunt',
  name: 'posts',
  description: 'Latest Product Hunt launches (optional category filter)',
  domain: 'www.producthunt.com',
  strategy: Strategy.PUBLIC,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
    {
      name: 'category',
      type: 'string',
      default: '',
      help: `Category filter: ${CATEGORIES.join(', ')}`,
    },
  ],
  columns: ['rank', 'name', 'tagline', 'author', 'date', 'url'],
  func: async (_page, args) => {
    const count = Math.min(Number(args.limit) || 20, 50);
    const category = String(args.category ?? '').trim() || undefined;
    const posts = await fetchFeed(category);
    return posts.slice(0, count);
  },
});
