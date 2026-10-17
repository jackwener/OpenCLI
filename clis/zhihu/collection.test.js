import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

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

});
