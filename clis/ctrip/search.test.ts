import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import './search.js';

describe('ctrip search', () => {
  const command = getRegistry().get('ctrip/search');

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps live endpoint results into ranked rows', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Response: {
        searchResults: [
          {
            displayName: '苏州, 江苏, 中国',
            displayType: '城市',
            commentScore: 0,
            price: '',
          },
          {
            word: '姑苏区',
            type: '行政区',
            cStar: 4.8,
            minPrice: 320,
          },
        ],
      },
    }), { status: 200 })));

    const result = await command!.func!(null as any, { query: '苏州', limit: 3 });
    expect(result).toEqual([
      {
        rank: 1,
        name: '苏州, 江苏, 中国',
        type: '城市',
        score: 0,
        price: '',
        url: '',
      },
      {
        rank: 2,
        name: '姑苏区',
        type: '行政区',
        score: 4.8,
        price: 320,
        url: '',
      },
    ]);
  });

  it('rejects empty queries', async () => {
    await expect(command!.func!(null as any, { query: '   ', limit: 3 })).rejects.toThrow('Search keyword cannot be empty');
  });

  it('surfaces fetch failures as CliError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));

    await expect(command!.func!(null as any, { query: '苏州', limit: 3 })).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'ctrip search failed with status 503',
    });
  });

  it('surfaces empty results as EmptyResultError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      Response: { searchResults: [] },
    }), { status: 200 })));

    await expect(command!.func!(null as any, { query: '苏州', limit: 3 })).rejects.toThrow('ctrip search returned no data');
  });
});
