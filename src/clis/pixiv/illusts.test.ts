import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { getRegistry } from '../../registry.js';
import './illusts.js';

function createPageMock(evaluateResults: any[]): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

describe('pixiv illusts', () => {
  it('throws AuthRequiredError when profile fetch fails', async () => {
    const cmd = getRegistry().get('pixiv/illusts');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([{ error: 401 }]);

    await expect(cmd!.func!(page, { 'user-id': '11', limit: 5 })).rejects.toThrow('HTTP 401');
  });

  it('returns empty array when user has no illusts', async () => {
    const cmd = getRegistry().get('pixiv/illusts');

    const page = createPageMock([
      { body: { illusts: {} } },
    ]);

    const result = await cmd!.func!(page, { 'user-id': '11', limit: 5 });
    expect(result).toEqual([]);
  });

  it('fetches illust IDs then batch-fetches details', async () => {
    const cmd = getRegistry().get('pixiv/illusts');

    const page = createPageMock([
      // Step 1: profile/all returns illust IDs
      {
        body: {
          illusts: { '99999': null, '88888': null, '77777': null },
        },
      },
      // Step 2: batch detail response
      {
        body: {
          works: {
            '99999': {
              id: '99999',
              title: 'Latest Work',
              pageCount: 2,
              bookmarkCount: 300,
              tags: ['original', 'fantasy'],
              createDate: '2025-01-15T12:00:00+09:00',
            },
            '88888': {
              id: '88888',
              title: 'Older Work',
              pageCount: 1,
              bookmarkCount: 150,
              tags: ['landscape'],
              createDate: '2024-12-01T10:00:00+09:00',
            },
          },
        },
      },
    ]);

    const result = (await cmd!.func!(page, { 'user-id': '11', limit: 3 })) as any[];

    // Should be sorted newest first (99999 > 88888 > 77777)
    expect(result).toHaveLength(2); // 77777 has no detail data, filtered out
    expect(result[0]).toMatchObject({
      rank: 1,
      title: 'Latest Work',
      illust_id: '99999',
      pages: 2,
      bookmarks: 300,
      created: '2025-01-15',
    });
    expect(result[1]).toMatchObject({
      rank: 2,
      title: 'Older Work',
      illust_id: '88888',
    });
  });

  it('respects the limit on illust IDs fetched', async () => {
    const cmd = getRegistry().get('pixiv/illusts');

    const page = createPageMock([
      {
        body: {
          illusts: { '100': null, '200': null, '300': null, '400': null, '500': null },
        },
      },
      {
        body: {
          works: {
            '500': { id: '500', title: 'W5', pageCount: 1, bookmarkCount: 0, tags: [], createDate: '' },
            '400': { id: '400', title: 'W4', pageCount: 1, bookmarkCount: 0, tags: [], createDate: '' },
          },
        },
      },
    ]);

    const result = (await cmd!.func!(page, { 'user-id': '11', limit: 2 })) as any[];
    expect(result).toHaveLength(2);
  });
});
