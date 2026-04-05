import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserFetchMock } = vi.hoisted(() => ({
  browserFetchMock: vi.fn(),
}));

vi.mock('./_shared/browser-fetch.js', () => ({
  browserFetch: browserFetchMock,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './profile.js';

describe('douyin profile registration', () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
  });

  it('registers the profile command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'profile');
    expect(cmd).toBeDefined();
  });

  it('maps the current user payload shape returned by creator center', async () => {
    const registry = getRegistry();
    const cmd = [...registry.values()].find(c => c.site === 'douyin' && c.name === 'profile');
    expect(cmd?.func).toBeDefined();
    if (!cmd?.func) throw new Error('douyin profile command not registered');

    browserFetchMock.mockResolvedValueOnce({
      user: {
        uid: '100',
        nickname: 'creator',
        follower_count: 12,
        following_count: 3,
        aweme_count: 7,
      },
    });

    const rows = await cmd.func({} as never, {});

    expect(rows).toEqual([
      {
        uid: '100',
        nickname: 'creator',
        follower_count: 12,
        following_count: 3,
        aweme_count: 7,
      },
    ]);
  });
});
