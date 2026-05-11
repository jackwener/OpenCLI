import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot-rank.js';

describe('eastmoney hot-rank command', () => {
  it('registers the command with correct metadata', () => {
    const command = getRegistry().get('eastmoney/hot-rank');
    expect(command).toBeDefined();
    expect(command).toMatchObject({
      site: 'eastmoney',
      name: 'hot-rank',
      description: expect.stringContaining('东方财富'),
      domain: 'guba.eastmoney.com',
      navigateBefore: true,
    });
  });

  it('returns hot stock data from the page', async () => {
    const command = getRegistry().get('eastmoney/hot-rank');
    const mockData = [
      { rank: 1, symbol: '600519', name: '贵州茅台', price: '1680.00', changePercent: '+2.35%', heat: '28.5万', url: 'https://guba.eastmoney.com/list,600519.html' },
      { rank: 2, symbol: '000001', name: '平安银行', price: '12.50', changePercent: '-0.80%', heat: '15.2万', url: 'https://guba.eastmoney.com/list,000001.html' },
    ];
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(mockData),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(mockData[0]);
    expect(page.goto).toHaveBeenCalledWith('https://guba.eastmoney.com/rank/');
  });

  it('respects the limit parameter', async () => {
    const command = getRegistry().get('eastmoney/hot-rank');
    const mockData = Array.from({ length: 30 }, (_, i) => ({
      rank: i + 1, symbol: `${i}`, name: `stock${i}`, price: '0', changePercent: '0%', heat: '0', url: '',
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
    const command = getRegistry().get('eastmoney/hot-rank');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toEqual([]);
  });
});
