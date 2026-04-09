import { describe, expect, it } from 'vitest';
import {
  __test__,
  toProcurementDetailRecord,
  toProcurementSearchRecords,
} from './procurement-contract.js';

describe('procurement contract helpers', () => {
  it('builds v2 search records with compatibility fields', () => {
    const rows = toProcurementSearchRecords(
      [
        {
          title: '某项目电梯采购公告',
          url: 'https://example.com/notice/detail?id=1',
          date: '2026-04-09',
          contextText: '招标公告 项目编号：ABC-123 预算金额：100万元 投标截止时间：2026-04-30',
        },
      ],
      {
        site: 'jianyu',
        query: '电梯',
        limit: 10,
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].rank).toBe(1);
    expect(rows[0].publish_time).toBe('2026-04-09');
    expect(rows[0].date).toBe('2026-04-09');
    expect(rows[0].summary).toBe(rows[0].snippet);
    expect(rows[0].content_type).toBe('notice');
    expect(rows[0].source_site).toBe('jianyu');
    expect(rows[0].project_code).toContain('ABC-123');
  });

  it('throws extraction_drift when all rows are navigation noise', () => {
    expect(() => toProcurementSearchRecords(
      [
        {
          title: '官网首页',
          url: 'https://example.com/index',
          contextText: '官网首页 联系我们',
        },
      ],
      {
        site: 'ggzy',
        query: '电梯',
        limit: 10,
      },
    )).toThrow('[taxonomy=extraction_drift]');
  });

  it('builds detail record with evidence blocks', () => {
    const detail = toProcurementDetailRecord(
      {
        title: '电梯采购公告',
        url: 'https://example.com/notice/detail/100',
        contextText: '项目编号：A-100。预算金额：200万元。投标截止时间：2026年04月30日。',
      },
      {
        site: 'powerchina',
        query: '电梯',
      },
    );
    expect(detail.content_type).toBe('notice');
    expect(detail.detail_text).toContain('预算金额');
    expect(detail.evidence_blocks.length).toBeGreaterThan(0);
  });

  it('classifies detail urls and content type', () => {
    expect(__test__.isDetailPage('https://a.com/notice/detail?id=1')).toBe(true);
    expect(__test__.isDetailPage('https://shandong.jianyu360.cn/jybx/20260310_26030938267551.html')).toBe(true);
    expect(__test__.isDetailPage('https://a.com/search?page=1')).toBe(false);
    expect(__test__.classifyContentType('中标结果公告', 'https://a.com/detail/1', '中标候选人')).toBe('result');
    expect(__test__.classifyContentType(
      '电梯采购公告',
      'https://shandong.jianyu360.cn/jybx/20260310_26030938267551.html',
      '首页 帮助中心 招标公告',
    )).toBe('notice');
  });
});
