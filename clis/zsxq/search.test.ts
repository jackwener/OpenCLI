import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../src/registry.js';
import './search.js';

describe('zsxq search command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('requires an explicit group_id when there is no active group context', async () => {
    const command = getRegistry().get('zsxq/search');
    expect(command?.func).toBeTypeOf('function');

    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(null),
    } as any;

    await expect(command!.func!(mockPage, { keyword: 'opencli', limit: 20 })).rejects.toMatchObject({
      code: 'ARGUMENT',
      message: 'Cannot determine active group_id',
    });

    expect(mockPage.goto).toHaveBeenCalledWith('https://wx.zsxq.com');
    expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
  });
});
