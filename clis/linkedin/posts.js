import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  collectPosts,
  DEFAULT_POSTS_LIMIT,
  MAX_POSTS_LIMIT,
} from './posts-core.js';

cli({
  site: 'linkedin',
  name: 'posts',
  access: 'read',
  description: 'Export visible posts from a LinkedIn profile activity page with engagement metrics',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
    { name: 'limit', type: 'int', default: DEFAULT_POSTS_LIMIT, help: `Maximum posts to return (1-${MAX_POSTS_LIMIT})` },
  ],
  columns: ['rank', 'author', 'posted_at', 'body', 'reactions', 'comments', 'reposts', 'impressions', 'media', 'media_urls', 'url', 'raw_text'],
  func: async (page, args) => collectPosts(page, args),
});
