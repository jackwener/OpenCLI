import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthRequiredError, EmptyResultError } from '../../errors.js';

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

vi.mock('./utils.js', () => ({
  apiGet: mockApiGet,
}));

import { getRegistry } from '../../registry.js';
import './subtitle.js';

describe('bilibili subtitle', () => {
  const command = getRegistry().get('bilibili/subtitle');
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  } as any;

  beforeEach(() => {
    mockApiGet.mockReset();
    page.goto.mockClear();
    page.evaluate.mockReset();
  });

  it('throws AuthRequiredError when bilibili hides subtitles behind login', async () => {
    page.evaluate.mockResolvedValueOnce(123456);
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        need_login_subtitle: true,
        subtitle: {
          subtitles: [],
        },
      },
    });

    await expect(command!.func!(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toSatisfy((err: Error) =>
      err instanceof AuthRequiredError && /login|登录/i.test(err.message),
    );
  });

  it('throws EmptyResultError when a video truly has no subtitles', async () => {
    page.evaluate.mockResolvedValueOnce(123456);
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: {
          subtitles: [],
        },
      },
    });

    await expect(command!.func!(page, { bvid: 'BV1GbXPBeEZm' })).rejects.toThrow(EmptyResultError);
  });
});
