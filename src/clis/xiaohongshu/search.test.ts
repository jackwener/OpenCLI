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
        bodyPreview: '登录后查看搜索结果',
        results: [],
      },
    ]);

    await expect(cmd!.func!(page, { query: '特斯拉', limit: 5 })).rejects.toThrow(
      'Xiaohongshu search results are blocked behind a login wall'
    );
  });

  it('keeps the search_result url and enriches rows with note details', async () => {
    const cmd = getRegistry().get('xiaohongshu/search');
    expect(cmd?.func).toBeTypeOf('function');

    const detailUrl =
      'https://www.xiaohongshu.com/search_result/68e90be80000000004022e66?xsec_token=test-token&xsec_source=';
    const page = createPageMock([
      {
        loginWall: false,
        bodyPreview: '',
        results: [
          {
            title: '某鱼买FSD被坑了4万',
            author: '随风',
            likes: '261',
            url: detailUrl,
            author_url:
              'https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40?xsec_token=user-token&xsec_source=pc_search',
          },
        ],
      },
      {
        title: '某鱼买FSD被坑了4万',
        author: '随风',
        content: '今天早上提车，昨天深夜，心血来潮搜了一下x鱼。',
        comment_count: '302',
        comments: ['KA330: 没有被坑啊。', 'NONO: 你怎么敢某鱼花4.3W买的'],
      },
    ]);

    const result = await cmd!.func!(page, { query: '特斯拉', limit: 1 });

    expect((page.goto as any).mock.calls[1][0]).toBe(detailUrl);
    expect(result).toEqual([
      {
        rank: 1,
        title: '某鱼买FSD被坑了4万',
        author: '随风',
        likes: '261',
        url: detailUrl,
        author_url:
          'https://www.xiaohongshu.com/user/profile/635a9c720000000018028b40?xsec_token=user-token&xsec_source=pc_search',
        content: '今天早上提车，昨天深夜，心血来潮搜了一下x鱼。',
        comment_count: '302',
        comments: ['KA330: 没有被坑啊。', 'NONO: 你怎么敢某鱼花4.3W买的'],
      },
    ]);
  });
});
