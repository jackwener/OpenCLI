import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('powerchina search helpers', () => {
  it('builds candidate URLs with keyword variants', () => {
    const candidates = __test__.buildSearchCandidates('电梯');
    expect(candidates[0]).toContain('keyword=%E7%94%B5%E6%A2%AF');
    expect(candidates.some((item) => item.includes('/search?keywords='))).toBe(true);
    expect(candidates.some((item) => item === 'https://bid.powerchina.cn/search')).toBe(true);
  });

  it('normalizes date text', () => {
    expect(__test__.normalizeDate('2026-4-7')).toBe('2026-04-07');
    expect(__test__.normalizeDate('公告时间：2026年04月07日')).toBe('2026-04-07');
  });

  it('deduplicates title/url pairs', () => {
    const deduped = __test__.dedupeCandidates([
      { title: 'A', url: 'https://a.com/1', date: '2026-04-07' },
      { title: 'A', url: 'https://a.com/1', date: '2026-04-07' },
      { title: 'B', url: 'https://a.com/1', date: '2026-04-07' },
    ]);
    expect(deduped).toHaveLength(2);
  });
});

