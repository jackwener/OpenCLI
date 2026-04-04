import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import './topic.js';

describe('zsxq topic command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('maps topic detail 404 responses to NOT_FOUND before fetching comments', async () => {
    const command = getRegistry().get('zsxq/topic');
    expect(command?.func).toBeTypeOf('function');

    const mockPage = {
      goto: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce({
          ok: true,
          status: 404,
          url: 'https://api.zsxq.com/v2/topics/404',
          data: null,
        }),
    } as any;

    await expect(command!.func!(mockPage, { id: '404', comment_limit: 20 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Topic 404 not found',
    });

    expect(mockPage.goto).toHaveBeenCalledWith('https://wx.zsxq.com');
    expect(mockPage.evaluate).toHaveBeenCalledTimes(2);
  });
});
