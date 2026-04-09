import { describe, expect, it } from 'vitest';
import { __test__ } from './search.js';

describe('jianyu search helpers', () => {
  it('builds candidate URLs with supsearch as preferred entry', () => {
    const candidates = __test__.buildSearchCandidates('procurement');
    expect(candidates[0]).toContain('/jylab/supsearch/index.html');
    expect(candidates[0]).toContain('keywords=procurement');
    expect(candidates[0]).toContain('selectType=title');
    expect(candidates[0]).toContain('searchGroup=1');
  });

  it('builds supsearch URL with required query params', () => {
    const url = __test__.buildSearchUrl('procurement');
    expect(url).toContain('keywords=procurement');
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

  it('filters obvious navigation rows before quality gate', () => {
    const filtered = __test__.filterNavigationRows('电梯', [
      { title: '招标公告', url: 'https://www.jianyu360.cn/list/stype/ZBGG.html', date: '' },
      { title: '帮助中心', url: 'https://www.jianyu360.cn/helpCenter/index', date: '' },
      { title: '某项目电梯采购公告', url: 'https://www.jianyu360.cn/notice/detail/123', date: '2026-04-07' },
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].title).toContain('电梯采购公告');
  });

  it('rejects procurement rows that do not contain query evidence', () => {
    const filtered = __test__.filterNavigationRows('电梯', [
      {
        title: '某项目采购公告',
        url: 'https://www.jianyu360.cn/notice/detail/123',
        date: '2026-04-07',
        contextText: '招标公告 项目编号：ABC-123',
      },
    ]);
    expect(filtered).toHaveLength(0);
  });

  it('parses search-index markdown headings', () => {
    const rows = __test__.parseSearchIndexMarkdown(`
## [标题一](http://duckduckgo.com/l/?uddg=https%3A%2F%2Fbeijing.jianyu360.cn%2Fjybx%2F20260401_26033143187897.html)
## [标题二](https://www.jianyu360.cn/nologin/content/ABC.html)
`);
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('标题一');
    expect(rows[1].url).toContain('jianyu360.cn/nologin/content');
  });

  it('unwraps duckduckgo redirect links', () => {
    const direct = __test__.unwrapDuckDuckGoUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.jianyu360.cn%2Fnologin%2Fcontent%2FXYZ.html');
    expect(direct).toBe('https://www.jianyu360.cn/nologin/content/XYZ.html');
  });

  it('extracts publish date from jianyu jybx urls', () => {
    const date = __test__.extractDateFromJianyuUrl('https://shandong.jianyu360.cn/jybx/20260310_26030938267551.html');
    expect(date).toBe('2026-03-10');
  });

  it('normalizes api payload rows with fallback url/title fields', () => {
    const normalized = __test__.normalizeApiRow({
      noticeTitle: '某项目电梯采购公告',
      detailUrl: '/jybx/20260310_26030938267551.html',
      publishTime: '2026-03-10 09:00:00',
      buyer: '测试单位',
    });
    expect(normalized).toBeTruthy();
    expect(normalized?.title).toContain('电梯采购公告');
    expect(normalized?.url).toContain('/jybx/20260310_26030938267551.html');
    expect(normalized?.date).toBe('2026-03-10');
  });
});
