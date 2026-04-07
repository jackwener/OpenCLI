import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('jianyu search helpers', () => {
  it('builds supsearch URL with required query params', () => {
    const url = __test__.buildSearchUrl('电梯');
    expect(url).toContain('keywords=%E7%94%B5%E6%A2%AF');
    expect(url).toContain('selectType=title');
    expect(url).toContain('searchGroup=1');
  });

  it('normalizes common date formats', () => {
    expect(__test__.normalizeDate('2026-4-7')).toBe('2026-04-07');
    expect(__test__.normalizeDate('2026年4月7日')).toBe('2026-04-07');
    expect(__test__.normalizeDate('发布时间: 2026/04/07 09:00')).toBe('2026-04-07');
  });

  it('deduplicates by title and url', () => {
    const deduped = __test__.dedupeCandidates([
      { title: 'A', url: 'https://example.com/1', date: '2026-04-07' },
      { title: 'A', url: 'https://example.com/1', date: '2026-04-07' },
      { title: 'A', url: 'https://example.com/2', date: '2026-04-07' },
    ]);
    expect(deduped).toHaveLength(2);
  });
});

