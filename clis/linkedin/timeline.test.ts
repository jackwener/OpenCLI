import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import './timeline.js';

const { parseMetric, buildPostId, mergeTimelinePosts } = await import('./timeline.js').then(
  (m) => (m as any).__test__,
);

describe('linkedin timeline adapter', () => {
  const command = getRegistry().get('linkedin/timeline');

  it('registers the command with correct shape', () => {
    expect(command).toBeDefined();
    expect(command!.site).toBe('linkedin');
    expect(command!.name).toBe('timeline');
    expect(command!.domain).toBe('www.linkedin.com');
    expect(command!.strategy).toBe('cookie');
    expect(command!.browser).toBe(true);
    expect(typeof command!.func).toBe('function');
  });

  it('has limit arg with default 20', () => {
    const limitArg = command!.args.find((a) => a.name === 'limit');
    expect(limitArg).toBeDefined();
    expect(limitArg!.default).toBe(20);
  });

  it('includes expected columns', () => {
    expect(command!.columns).toEqual(
      expect.arrayContaining(['author', 'text', 'reactions', 'comments', 'url']),
    );
  });
});

describe('parseMetric', () => {
  it('parses plain numbers', () => {
    expect(parseMetric('42')).toBe(42);
    expect(parseMetric('1,234')).toBe(1234);
  });

  it('handles k/m suffixes', () => {
    expect(parseMetric('2.5k')).toBe(2500);
    expect(parseMetric('1.2M')).toBe(1200000);
  });

  it('returns 0 for empty/undefined', () => {
    expect(parseMetric('')).toBe(0);
    expect(parseMetric(undefined)).toBe(0);
    expect(parseMetric(null)).toBe(0);
  });
});

describe('buildPostId', () => {
  it('uses url when present', () => {
    expect(buildPostId({ url: 'https://linkedin.com/post/123' })).toBe(
      'https://linkedin.com/post/123',
    );
  });

  it('falls back to composite key', () => {
    const id = buildPostId({ author: 'Alice', posted_at: '2h', text: 'Hello world' });
    expect(id).toBe('Alice::2h::Hello world');
  });
});

describe('mergeTimelinePosts', () => {
  it('deduplicates by url', () => {
    const url = 'https://linkedin.com/post/1';
    const a = {
      id: url,
      author: 'Alice',
      author_url: '',
      headline: '',
      text: 'Hello',
      posted_at: '1h',
      reactions: 5,
      comments: 1,
      url,
    };
    const result = mergeTimelinePosts([a], [a]);
    expect(result).toHaveLength(1);
  });

  it('skips posts without author or text', () => {
    const empty = {
      id: '2',
      author: '',
      author_url: '',
      headline: '',
      text: 'some text',
      posted_at: '',
      reactions: 0,
      comments: 0,
      url: '',
    };
    const result = mergeTimelinePosts([], [empty]);
    expect(result).toHaveLength(0);
  });
});
