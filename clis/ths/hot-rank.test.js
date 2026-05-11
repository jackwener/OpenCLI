import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './hot-rank.js';

describe('ths hot-rank command', () => {
  it('registers the command with correct metadata', () => {
    const command = getRegistry().get('ths/hot-rank');
    expect(command).toBeDefined();
    expect(command).toMatchObject({
      site: 'ths',
      name: 'hot-rank',
      description: expect.stringContaining('同花顺'),
      domain: 'eq.10jqka.com.cn',
      navigateBefore: true,
    });
    expect(command.columns).toEqual(['rank', 'name', 'changePercent', 'heat', 'tags']);
  });

  it('includes tags column', () => {
    const command = getRegistry().get('ths/hot-rank');
    expect(command.columns).toContain('tags');
  });

  it('returns hot stock data with tags field', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const mockData = [
      { rank: 1, name: '圣阳股份', changePercent: '+10.00%', heat: '28.5万', tags: '动力电池回收,钠离子电池' },
    ];
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(mockData),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toHaveLength(1);
    expect(result[0].tags).toBe('动力电池回收,钠离子电池');
    expect(result[0].name).toBe('圣阳股份');
  });

  it('respects the limit parameter', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const mockData = Array.from({ length: 30 }, (_, i) => ({
      rank: i + 1, name: `stock${i}`, changePercent: '0%', heat: '0', tags: '',
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
    const command = getRegistry().get('ths/hot-rank');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    };
    const result = await command.func(page, { limit: 20 });
    expect(result).toEqual([]);
  });
});
