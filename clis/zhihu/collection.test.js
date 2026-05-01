import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

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
    const evaluate = vi.fn().mockImplementation(async (js) => {
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

    const page = { goto, evaluate };

    const result = await cmd.func(page, { id: '83283292', offset: 0, limit: 20 });
    
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

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };

    const result = await cmd.func(page, { id: '83283292', offset: 0, limit: 20 });
    
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

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };

    const result = await cmd.func(page, { id: '83283292', offset: 0, limit: 20 });
    
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
    };

    await expect(
      cmd.func(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('maps 403 errors to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
    };

    await expect(
      cmd.func(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('preserves non-auth fetch failures as CommandExecutionError', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
    };

    await expect(
      cmd.func(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('handles null evaluate response as fetch error', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue(null),
    };

    await expect(
      cmd.func(page, { id: '83283292', offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(CommandExecutionError);
  });

  it('rejects non-numeric collection IDs', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = { goto: vi.fn(), evaluate: vi.fn() };

    await expect(
      cmd.func(page, { id: "abc'; alert(1); //", offset: 0, limit: 20 }),
    ).rejects.toBeInstanceOf(ArgumentError);

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

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };

    const result = await cmd.func(page, { id: '83283292', offset: 40, limit: 20 });
    
    expect(result[0].rank).toBe(41); // offset 40 + index 0 + 1
    expect(evaluate).toHaveBeenCalledWith(
      expect.stringContaining('offset=40'),
    );
  });

  it('rejects invalid offset and limit before navigation', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = { goto: vi.fn(), evaluate: vi.fn() };

    await expect(cmd.func(page, { id: '83283292', offset: -1, limit: 20 }))
      .rejects.toBeInstanceOf(ArgumentError);
    await expect(cmd.func(page, { id: '83283292', offset: 0, limit: 0 }))
      .rejects.toBeInstanceOf(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('paginates until requested limit and deduplicates items', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const evaluate = vi.fn()
      .mockResolvedValueOnce({
        data: [
          {
            content: {
              type: 'answer',
              id: 1,
              question: { id: 1, title: 'A' },
              author: { name: 'alice' },
              content: 'A',
            },
          },
        ],
        paging: { totals: 3, is_end: false, next: 'https://www.zhihu.com/api/v4/collections/83283292/items?offset=1&limit=1' },
      })
      .mockResolvedValueOnce({
        data: [
          {
            content: {
              type: 'answer',
              id: 1,
              question: { id: 1, title: 'A duplicate' },
              author: { name: 'alice' },
              content: 'A',
            },
          },
          {
            content: {
              type: 'answer',
              id: 2,
              question: { id: 2, title: 'B' },
              author: { name: 'bob' },
              content: 'B',
            },
          },
        ],
        paging: { totals: 3, is_end: true },
      });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };

    const result = await cmd.func(page, { id: '83283292', offset: 0, limit: 2 });

    expect(result.map((row) => row.title)).toEqual(['A', 'B']);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(evaluate.mock.calls[1][0]).toContain('offset=1');
  });

  it('throws EmptyResultError for empty collection', async () => {
    const cmd = getRegistry().get('zhihu/collection');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({
        data: [],
        paging: { totals: 0 },
      }),
    };

    await expect(cmd.func(page, { id: '83283292', offset: 0, limit: 20 }))
      .rejects.toBeInstanceOf(EmptyResultError);
  });
});
