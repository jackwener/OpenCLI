import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { EmptyResultError } from '../../errors.js';
import { getRegistry } from '../../registry.js';
import './author-search.js';

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

describe('webofscience author-search', () => {
  it('submits the author search page and maps researcher results', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      true,
      [
        {
          name: 'Jane Doe',
          details: 'University of Testing Highly Cited Researcher',
          url: 'https://webofscience.clarivate.cn/author/record/A-1234-2024',
        },
        {
          name: 'John Smith',
          details: 'Institute of Examples',
          url: 'https://webofscience.clarivate.cn/author/record/B-9999-2020',
        },
      ],
    ]);

    const result = await cmd!.func!(page, { query: 'jane doe', limit: 1 });

    expect(page.goto).toHaveBeenCalledWith(
      'https://webofscience.clarivate.cn/wos/author/author-search',
      { settleMs: 4000 },
    );
    const submitJs = vi.mocked(page.evaluate).mock.calls[0]?.[0];
    expect(submitJs).toContain("pickInput('last name')");
    expect(submitJs).toContain("pickInput('first name')");
    expect(submitJs).toContain('"doe"');
    expect(submitJs).toContain('"jane"');
    expect(result).toEqual([
      {
        rank: 1,
        name: 'Jane Doe',
        details: 'University of Testing Highly Cited Researcher',
        url: 'https://webofscience.clarivate.cn/author/record/A-1234-2024',
      },
    ]);
  });

  it('throws EmptyResultError when no authors are found', async () => {
    const cmd = getRegistry().get('webofscience/author-search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([true, []]);
    await expect(cmd!.func!(page, { query: 'nobody' })).rejects.toThrow(EmptyResultError);
  });
});
