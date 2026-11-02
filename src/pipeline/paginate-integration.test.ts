import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '../types.js';
import { executePipeline } from './index.js';
import { getRegisteredStepNames } from './registry.js';
import { shouldUseBrowserSession } from '../capabilityRouting.js';
import { cli, getRegistry, Strategy } from '../registry.js';
import { validateClisWithTarget } from '../validate.js';

const pagination = {
  request: { url: 'https://example.test/items', params: { page: '${{ pagination.value }}' } },
  initial: 1, items: '${{ data.items }}', next: '${{ data.next }}',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getRegistry().delete('__pagination_test__/list');
});

describe('pagination pipeline integration', () => {
  it('runs through the registry and composes with map/select without losing completion metadata', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 1, title: 'One' }], next: 2 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ id: 2, title: 'Two' }], next: null }) }));
    const result = await executePipeline(null, [
      { paginate: pagination },
      { map: { select: 'items', title: '${{ item.title }}', complete: '${{ root.pagination.complete }}' } },
      { limit: '${{ args.limit }}' },
    ], { args: { limit: 1 } });
    expect(result).toEqual([{ title: 'One', complete: true }]);
  });

  it('releases the browser lease on a later page error without returning or retrying the first page', async () => {
    const error = new Error('Failed to fetch');
    const page = {
      fetchJson: vi.fn().mockResolvedValueOnce({ items: [1], next: 2 }).mockRejectedValueOnce(error),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    } as unknown as IPage;
    await expect(executePipeline(page, [{ paginate: pagination }])).rejects.toBe(error);
    expect(page.fetchJson).toHaveBeenCalledTimes(2);
    expect(page.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('requires completeness before allowing a downstream select to discard metadata', async () => {
    const page = { fetchJson: vi.fn().mockResolvedValue({ items: [1], next: 2 }) } as unknown as IPage;
    await expect(executePipeline(page, [
      { paginate: { ...pagination, maxPages: 1, requireComplete: true } },
      { select: 'items' },
    ])).rejects.toMatchObject({ code: 'PAGINATION_LIMIT' });
  });

  it('validates registered adapters and uses the existing public/authenticated routing rules', () => {
    cli({
      site: '__pagination_test__', name: 'list', access: 'read', description: 'Pagination fixture',
      strategy: Strategy.PUBLIC, browser: false, args: [], pipeline: [{ paginate: pagination }],
    });
    const command = getRegistry().get('__pagination_test__/list')!;
    expect(getRegisteredStepNames()).toContain('paginate');
    expect(validateClisWithTarget('__pagination_test__/list')).toMatchObject({ ok: true, errors: 0, warnings: 0 });
    expect(shouldUseBrowserSession(command)).toBe(false);
    expect(shouldUseBrowserSession({ ...command, func: undefined, browser: true, strategy: Strategy.COOKIE, navigateBefore: true })).toBe(true);
  });
});
