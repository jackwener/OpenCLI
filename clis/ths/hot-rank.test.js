import { describe, expect, it, vi } from 'vitest';
import { CliError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './hot-rank.js';

describe('ths hot-rank command', () => {
  it('registers the command with correct metadata', () => {
    const command = getRegistry().get('ths/hot-rank');
    expect(command).toBeDefined();
    expect(command).toMatchObject({
      site: 'ths',
      name: 'hot-rank',
      description: expect.stringContaining('同花顺'),
      domain: 'dq.10jqka.com.cn',
      browser: false,
    });
    expect(command.strategy).toBe('public');
    expect(command.columns).toEqual(['rank', 'name', 'changePercent', 'heat', 'tags']);
  });

  it('includes tags column', () => {
    const command = getRegistry().get('ths/hot-rank');
    expect(command.columns).toContain('tags');
  });

  it('fetches the public hot list API and maps authoritative ranks', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          stock_list: [
            {
              order: 21,
              name: '圣阳股份',
              rise_and_fall: '+10.00%',
              rate: '28.5万',
              tag: { concept_tag: ['动力电池回收'], popularity_tag: ['钠离子电池'] },
            },
          ],
        },
      }),
    });

    try {
      const result = await command.func({ limit: 20 });
      expect(fetchSpy).toHaveBeenCalledWith(__test__.THS_HOT_API_URL, expect.objectContaining({
        headers: expect.objectContaining({ Referer: 'https://eq.10jqka.com.cn/' }),
      }));
      expect(result).toEqual([
        { rank: 21, name: '圣阳股份', changePercent: '+10.00%', heat: '28.5万', tags: '动力电池回收,钠离子电池' },
      ]);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('respects the limit parameter', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          stock_list: Array.from({ length: 30 }, (_, i) => ({
            order: i + 1,
            name: `stock${i}`,
            rise_and_fall: '0%',
            rate: '0',
            tag: {},
          })),
        },
      }),
    });

    try {
      const result = await command.func({ limit: 10 });
      expect(result).toHaveLength(10);
      expect(result[9].rank).toBe(10);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws NO_DATA when the API shape has no stock list', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    try {
      await expect(command.func({ limit: 20 })).rejects.toMatchObject({ code: 'NO_DATA' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('throws HTTP_ERROR when the API request fails', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
    });

    try {
      await expect(command.func({ limit: 20 })).rejects.toBeInstanceOf(CliError);
      await expect(command.func({ limit: 20 })).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects invalid limits before fetching', async () => {
    const command = getRegistry().get('ths/hot-rank');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(command.func({ limit: 0 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(command.func({ limit: 101 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(command.func({ limit: 'abc' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('combines concept and popularity tags', () => {
    expect(__test__.tagsFromStock({
      tag: { concept_tag: ['AI'], popularity_tag: ['算力'] },
    })).toBe('AI,算力');
  });
});
