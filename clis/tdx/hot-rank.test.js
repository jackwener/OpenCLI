import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot-rank.js';

describe('tdx hot-rank command', () => {
  it('registers the command with correct metadata', () => {
    const command = getRegistry().get('tdx/hot-rank');
    expect(command).toBeDefined();
    expect(command).toMatchObject({
      site: 'tdx',
      name: 'hot-rank',
      description: expect.stringContaining('通达信'),
      domain: 'pul.tdx.com.cn',
      navigateBefore: true,
    });
    expect(command.columns).toEqual(['rank', 'symbol', 'name', 'changePercent', 'heat', 'tags']);
  });

  it('returns hot stock data from the page', async () => {
    const command = getRegistry().get('tdx/hot-rank');
    const mockData = [
      { rank: 1, symbol: '600519', name: '贵州茅台', changePercent: '+2.35%', heat: '1285', tags: '白酒', },
      { rank: 2, symbol: '000001', name: '平安银行', changePercent: '-0.80%', heat: '856', tags: '银行', },
    ];
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(mockData),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(mockData[0]);
  });

  it('respects the limit parameter', async () => {
    const command = getRegistry().get('tdx/hot-rank');
    const mockData = Array.from({ length: 30 }, (_, i) => ({
      rank: i + 1, symbol: `${i}`, name: `stock${i}`, changePercent: '0%', heat: '0', tags: '',
    }));
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(mockData),
    };
    const result = await command.func(page, { limit: 10 });
    expect(result).toHaveLength(10);
  });

  it('returns empty array when evaluate returns non-array', async () => {
    const command = getRegistry().get('tdx/hot-rank');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toEqual([]);
  });
});
