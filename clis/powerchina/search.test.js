import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('powerchina search helpers', () => {
  it('builds candidate URLs with keyword variants', () => {
    const candidates = __test__.buildSearchCandidates('procurement');
    expect(candidates[0]).toContain('keyword=procurement');
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

  it('filters obvious navigation rows before quality gate', () => {
    const filtered = __test__.filterNavigationRows([
      { title: '搜索', url: 'https://bid.powerchina.cn/search', date: '2026-04-07' },
      { title: '首页', url: 'https://bid.powerchina.cn/', date: '2026-04-07' },
      { title: 'English', url: 'https://bid.powerchina.cn/old/en', date: '' },
      { title: '某项目电梯采购公告', url: 'https://bid.powerchina.cn/notice/detail?id=123', date: '2026-04-07' },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toContain('电梯采购公告');
  });

  it('treats old/en language switch urls as navigation', () => {
    expect(__test__.isLikelyNavigationUrl('https://bid.powerchina.cn/old/en')).toBe(true);
  });

  it('treats language-toggle labels as navigation titles', () => {
    expect(__test__.isLikelyNavigationTitle('English')).toBe(true);
    expect(__test__.isLikelyNavigationTitle('EN')).toBe(true);
  });

  it('builds api detail urls with stable id', () => {
    const url = __test__.buildApiDetailUrl('2409419657');
    expect(url).toBe('https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/getInfo/2409419657');
  });

  it('maps api rows into normalized search candidates', () => {
    const mapped = __test__.toApiCandidate({
      id: '2409419657',
      title: '某项目电梯采购公告',
      announcementType: '招采公告',
      companyType: '3',
      titleTypeName: '货物类',
      source: '设备物资集中采购电子平台',
      publishTime: '2026-04-07 17:05:02',
      submissionDeadline: '2026-04-14',
    });
    expect(mapped).not.toBeNull();
    expect(mapped?.title).toContain('电梯采购公告');
    expect(mapped?.date).toBe('2026-04-07');
    expect(mapped?.url).toBe('https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/getInfo/2409419657');
  });
});
