import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseLimit } from './shared.js';
import { collectPosts } from './posts-core.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function sum(posts, field) {
  return posts.reduce((total, post) => total + (Number(post[field]) || 0), 0);
}

function summarize(posts) {
  if (!Array.isArray(posts)) {
    throw new CommandExecutionError('LinkedIn post analytics expected an array of posts');
  }
  if (posts.length === 0) {
    throw new EmptyResultError('linkedin post-analytics', 'No posts were available for analytics.');
  }
  const latest = posts[0] || {};
  return {
    posts_analyzed: posts.length,
    total_reactions: sum(posts, 'reactions'),
    total_comments: sum(posts, 'comments'),
    total_reposts: sum(posts, 'reposts'),
    total_impressions: sum(posts, 'impressions'),
    posts_with_media: posts.filter((post) => post.media).length,
    posts_with_urls: posts.filter((post) => post.url).length,
    latest_posted_at: latest.posted_at || '',
    latest_reactions: Number(latest.reactions) || 0,
    latest_comments: Number(latest.comments) || 0,
    latest_reposts: Number(latest.reposts) || 0,
    latest_impressions: Number(latest.impressions) || 0,
    latest_url: latest.url || '',
  };
}

cli({
  site: 'linkedin',
  name: 'post-analytics',
  access: 'read',
  description: 'Summarize raw visible LinkedIn post counters without custom scoring or classification',
  domain: 'www.linkedin.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'profile-url', type: 'string', required: false, help: 'LinkedIn /in/<handle>/ profile URL. Defaults to /in/me/.' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: 'Maximum posts to summarize (1-100)' },
  ],
  columns: [
    'posts_analyzed',
    'total_reactions',
    'total_comments',
    'total_reposts',
    'total_impressions',
    'posts_with_media',
    'posts_with_urls',
    'latest_posted_at',
    'latest_reactions',
    'latest_comments',
    'latest_reposts',
    'latest_impressions',
    'latest_url',
  ],
  func: async (page, args) => {
    const limit = parseLimit(args.limit, DEFAULT_LIMIT, MAX_LIMIT);
    const posts = await collectPosts(page, { ...args, limit });
    return [summarize(posts)];
  },
});

export const __test__ = {
  summarize,
};
