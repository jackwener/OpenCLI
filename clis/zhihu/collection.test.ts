import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

// Mock logger
vi.mock('@jackwener/opencli/logger', () => ({
  log: {
    info: vi.fn(),
    status: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    verbose: vi.fn(),
    debug: vi.fn(),
    step: vi.fn(),
    stepResult: vi.fn(),
  },
}));

import './collection.js';

describe('zhihu collection', () => {
  it('returns collection items from the Zhihu API', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    expect(cmd?.func).toBeTypeOf('function');

    const goto = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi.fn().mockImplementation(async (js: string) => {
      expect(js).toContain('collections/83283292/items');
      expect(js).toContain("credentials: 'include'");
      return {
        data: [
          {
            content: {
              type: 'answer',
              id: 123456,
              question: { id: 789012, title: 'Test Question' },
              author: { name: 'test_author' },
              voteup_count: 42,
              content: '<p>Test answer content</p>',
              url: 'https://www.zhihu.com/question/789012/answer/123456',
            },
          },
        ],
        paging: { totals: 100 },
      };
    });

    const page = { goto, evaluate } as any;

    const result = await cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }) as any[];
    
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      rank: 1,
      type: 'answer',
      title: 'Test Question',
      author: 'test_author',
      votes: 42,
      url: 'https://www.zhihu.com/question/789012/answer/123456',
    });

    expect(goto).toHaveBeenCalledWith('https://www.zhihu.com');
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('handles article type items', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const evaluate = vi.fn().mockResolvedValue({
      data: [
        {
          content: {
            type: 'article',
            id: 987654,
            title: 'Test Article',
            author: { name: 'article_author' },
            voteup_count: 100,
            content: '<p>Article content</p>',
            url: 'https://zhuanlan.zhihu.com/p/987654',
          },
        },
      ],
      paging: { totals: 50 },
    });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate } as any;

    const result = await cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }) as any[];
    
    expect(result[0]).toMatchObject({
      type: 'article',
      title: 'Test Article',
      author: 'article_author',
      votes: 100,
    });
  });

  it('handles pin type items', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const evaluate = vi.fn().mockResolvedValue({
      data: [
        {
          content: {
            type: 'pin',
            id: 111222,
            author: { name: 'pin_author' },
            reaction_count: 25,
            content: [{ content: 'Pin content here' }],
            url: 'https://www.zhihu.com/pin/111222',
          },
        },
      ],
      paging: { totals: 30 },
    });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate } as any;

    const result = await cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }) as any[];
    
    expect(result[0]).toMatchObject({
      type: 'pin',
      title: '想法',
      author: 'pin_author',
      votes: 25,
    });
  });

  it('maps auth failures to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 401 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps 403 errors to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('preserves non-auth fetch failures as CliError', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
    } as any;

    await expect(
      cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'Zhihu collection request failed (HTTP 500)',
    });
  });

  it('handles null evaluate response as fetch error', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    } as any;

    await expect(
      cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toMatchObject({
      code: 'FETCH_ERROR',
      message: 'Zhihu collection request failed',
    });
  });

  it('rejects non-numeric collection IDs', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = { goto: vi.fn(), evaluate: vi.fn() } as any;

    await expect(
      cmd!.func!(page, { id: "abc'; alert(1); //", offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(CliError);

    expect(page.goto).not.toHaveBeenCalled();
    expect(page.evaluate).not.toHaveBeenCalled();
  });

  it('respects pagination offset', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const evaluate = vi.fn().mockResolvedValue({
      data: [
        {
          content: {
            type: 'answer',
            id: 1,
            question: { id: 1, title: 'Test' },
            author: { name: 'author' },
            voteup_count: 10,
            content: 'Content',
          },
        },
      ],
      paging: { totals: 100 },
    });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate } as any;

    const result = await cmd!.func!(page, { id: '83283292', offset: 40, limit: 20 }) as any[];
    
    expect(result[0].rank).toBe(41); // offset 40 + index 0 + 1
    expect(evaluate).toHaveBeenCalledWith(
      expect.stringContaining('offset=40'),
    );
  });

  it('returns empty array for empty collection', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        data: [],
        paging: { totals: 0 },
      }),
    } as any;

    const result = await cmd!.func!(page, { id: '83283292', offset: 0, limit: 20 }) as any[];
    
    expect(result).toEqual([]);
  });
});
