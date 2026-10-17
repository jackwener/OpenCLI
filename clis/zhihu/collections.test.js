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

import './collections.js';

describe('zhihu collections', () => {

  it('paginates collection list and deduplicates by collection id', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ url_token: 'testuser', id: 'abc123' })
      .mockResolvedValueOnce({
        data: [{ id: 1, title: 'A', item_count: 1, description: '' }],
        paging: { totals: 3, is_end: false, next: 'https://www.zhihu.com/api/v4/people/testuser/collections?offset=1&limit=1' },
      })
      .mockResolvedValueOnce({
        data: [
          { id: 1, title: 'A duplicate', item_count: 1, description: '' },
          { id: 2, title: 'B', item_count: 2, description: '' },
        ],
        paging: { totals: 3, is_end: true },
      });
    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };

    const result = await cmd.func(page, { limit: 2 });

    expect(result.map((row) => row.title)).toEqual(['A', 'B']);
    expect(evaluate).toHaveBeenCalledTimes(3);
    expect(evaluate.mock.calls[2][0]).toContain('offset=1');
  });

});
