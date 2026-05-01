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

import './collections.js';

describe('zhihu collections', () => {
  it('returns list of collections', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    expect(cmd?.func).toBeTypeOf('function');

    const goto = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    const evaluate = vi.fn().mockImplementation(async (js) => {
      callCount++;
      if (callCount === 1) {
        expect(js).toContain('api/v4/me');
        return { url_token: 'testuser', id: 'abc123' };
      }
      expect(js).toContain('people/testuser/collections');
      return {
        data: [
          { id: 123456, title: '我的收藏夹', item_count: 42, description: '待读' },
          { id: 789012, title: '技术文章', item_count: 100, description: '' },
        ],
        paging: { totals: 2 },
      };
    });

    const page = { goto, evaluate };
    const result = await cmd.func(page, { limit: 20 });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      rank: 1,
      title: '我的收藏夹',
      answer_count: 0,
      description: '待读',
      collection_id: '123456',
    });
    expect(result[1]).toMatchObject({
      rank: 2,
      title: '技术文章',
      answer_count: 0,
      description: '',
      collection_id: '789012',
    });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('returns list of collections with answer_count', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    let callCount = 0;
    const evaluate = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { url_token: 'testuser', id: 'abc123' };
      }
      return {
        data: [{ id: 111, title: '默认收藏夹', answer_count: 15, description: 'test desc' }],
        paging: { totals: 1 },
      };
    });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
    const result = await cmd.func(page, { limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      title: '默认收藏夹',
      answer_count: 15,
      description: 'test desc',
      collection_id: '111',
    });
  });

  it('maps auth failures to AuthRequiredError', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockResolvedValue({ __httpError: 401 }),
    };

    await expect(cmd.func(page, { limit: 20 }))
      .rejects.toBeInstanceOf(AuthRequiredError);
  });

  it('handles missing url_token', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    let callCount = 0;
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return { id: 'abc123' };
        return {};
      }),
    };

    await expect(cmd.func(page, { limit: 20 }))
      .rejects.toBeInstanceOf(CliError);
  });

  it('respects limit parameter', async () => {
    const cmd = getRegistry().get('zhihu/collections');
    let callCount = 0;
    const evaluate = vi.fn().mockImplementation(async (js) => {
      callCount++;
      if (callCount === 1) {
        return { url_token: 'testuser', id: 'abc123' };
      }
      expect(js).toContain('limit=10');
      return {
        data: [{ id: 1, title: 'Test', answer_count: 0, description: '' }],
        paging: { totals: 1 },
      };
    });

    const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
    const result = await cmd.func(page, { limit: 10 });

    expect(result).toHaveLength(1);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
