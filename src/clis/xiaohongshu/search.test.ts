import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { getRegistry } from '../../registry.js';
import './search.js';

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

describe('xiaohongshu search', () => {
  it('throws a clear error when the search page is blocked by a login wall', async () => {
    const cmd = getRegistry().get('xiaohongshu/search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      {
        loginWall: true,
        results: [],
      },
    ]);

    await expect(cmd!.func!(page, { query: '特斯拉', limit: 5 })).rejects.toThrow(
      'Xiaohongshu search results are blocked behind a login wall'
    );
  });

  it('returns ranked results with search_result url and author_url preserved', async () => {
    const cmd = getRegistry().get('xiaohongshu/search');
    expect(cmd?.func).toBeTypeOf('function');

    const detailUrl =
      'https://www.xiaohongshu.com/search_result/68e90be80000000004022e66?xsec_token=test-token&xsec_source=';
    const authorUrl =
      'https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40?xsec_token=user-token&xsec_source=pc_search';

    const page = createPageMock([
      {
        loginWall: false,
        results: [
          {
            title: '某鱼买FSD被坑了4万',
            author: '随风',
            likes: '261',
            url: detailUrl,
            author_url: authorUrl,
          },
        ],
      },
    ]);

    const result = await cmd!.func!(page, { query: '特斯拉', limit: 1 });

    // Should only do one goto (the search page itself), no per-note detail navigation
    expect((page.goto as any).mock.calls).toHaveLength(1);

    expect(result).toEqual([
      {
        rank: 1,
        title: '某鱼买FSD被坑了4万',
        author: '随风',
        likes: '261',
        url: detailUrl,
        author_url: authorUrl,
      },
    ]);
  });

  it('filters out results with no title and respects the limit', async () => {
    const cmd = getRegistry().get('xiaohongshu/search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      {
        loginWall: false,
        results: [
          {
            title: 'Result A',
            author: 'UserA',
            likes: '10',
            url: 'https://www.xiaohongshu.com/search_result/aaa',
            author_url: '',
          },
          {
            title: '',
            author: 'UserB',
            likes: '5',
            url: 'https://www.xiaohongshu.com/search_result/bbb',
            author_url: '',
          },
          {
            title: 'Result C',
            author: 'UserC',
            likes: '3',
            url: 'https://www.xiaohongshu.com/search_result/ccc',
            author_url: '',
          },
        ],
      },
    ]);

    const result = (await cmd!.func!(page, { query: '测试', limit: 1 })) as any[];

    // limit=1 should return only the first valid-titled result
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ rank: 1, title: 'Result A' });
  });
});
