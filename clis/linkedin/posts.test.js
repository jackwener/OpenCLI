import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './posts.js';

const { activityUrl, parseMetric, parseReactionText, normalizePost } = await import('./posts-core.js');

describe('linkedin posts adapter', () => {
  const command = getRegistry().get('linkedin/posts');

  it('registers command shape', () => {
    expect(command).toBeDefined();
    expect(command.strategy).toBe('cookie');
    expect(command.browser).toBe(true);
    expect(command.columns).toContain('reactions');
    expect(command.columns).toContain('media_urls');
    expect(command.columns).toContain('raw_text');
  });

  it('builds profile activity URL', () => {
    expect(activityUrl('https://www.linkedin.com/in/gauravsaxena1997/')).toBe('https://www.linkedin.com/in/gauravsaxena1997/recent-activity/all/');
  });

  it('parses compact metrics', () => {
    expect(parseMetric('1,200 reactions')).toBe(1200);
    expect(parseMetric('2.5k comments')).toBe(2500);
    expect(parseReactionText('19 Divyang Bhargava and 18 others 12 comments')).toBe(19);
    expect(parseReactionText('32 5 comments')).toBe(32);
  });

  it('normalizes post rows and rejects identity-free rows', () => {
    expect(() => normalizePost({ text: '', url: '' })).toThrow(CommandExecutionError);
    expect(normalizePost({ author: 'AliceAlice', body: 'Post body', reactions: '3', impressions: '12', media: 'image: demo', media_urls: 'https://example.com/a.png' }))
      .toMatchObject({ author: 'Alice', body: 'Post body', reactions: 3, impressions: 12, media: 'image: demo', media_urls: 'https://example.com/a.png' });
    expect(normalizePost({ body: 'Post body', media_urls: 'javascript:alert(1) | https://example.com/a.png' }))
      .toMatchObject({ media_urls: 'https://example.com/a.png' });
    expect(normalizePost({ body: 'Post body', url: 'javascript:alert(1)' }))
      .toMatchObject({ url: '' });
  });
});
