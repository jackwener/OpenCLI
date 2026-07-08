import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import './post-analytics.js';

const { summarize } = await import('./post-analytics.js').then((m) => m.__test__);

describe('linkedin post-analytics adapter', () => {
  const command = getRegistry().get('linkedin/post-analytics');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toContain('total_reactions');
    expect(command.columns).not.toContain('total_engagement_score');
  });

  it('summarizes raw counters without custom scoring', () => {
    const out = summarize([
      { body: 'Latest post', reactions: 10, comments: 3, reposts: 1, impressions: 50, media: 'image', url: 'u1', posted_at: '1d' },
      { body: 'Older post', reactions: 2, comments: 0, reposts: 0, impressions: 20, media: '', url: '', posted_at: '2d' },
    ]);
    expect(out).toMatchObject({
      posts_analyzed: 2,
      total_reactions: 12,
      total_comments: 3,
      total_reposts: 1,
      total_impressions: 70,
      posts_with_media: 1,
      posts_with_urls: 1,
      latest_posted_at: '1d',
      latest_url: 'u1',
    });
  });

  it('rejects empty analytics input', () => {
    expect(() => summarize([])).toThrow(EmptyResultError);
  });
});
