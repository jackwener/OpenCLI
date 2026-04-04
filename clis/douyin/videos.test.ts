import { beforeEach, describe, expect, it, vi } from 'vitest';

const { browserFetchMock } = vi.hoisted(() => ({
  browserFetchMock: vi.fn(),
}));

vi.mock('./_shared/browser-fetch.js', () => ({
  browserFetch: browserFetchMock,
}));

import { getRegistry } from '../../src/registry.js';
import './videos.js';

describe('douyin videos', () => {
  beforeEach(() => {
    browserFetchMock.mockReset();
  });

  it('registers the videos command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const cmd = values.find(c => c.site === 'douyin' && c.name === 'videos');
    expect(cmd).toBeDefined();
  });

  it('parses the current creator work_list api shape', async () => {
    const registry = getRegistry();
    const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'videos');
    expect(command?.func).toBeDefined();
    if (!command?.func) throw new Error('douyin videos command not registered');

    browserFetchMock.mockResolvedValueOnce({
      aweme_list: [
        {
          aweme_id: '7000000000000000001',
          desc: '测试视频标题',
          create_time: 1581571130,
          statistics: {
            play_count: 0,
            digg_count: 12,
          },
          status: {
            is_private: true,
          },
        },
      ],
    });

    const rows = await command.func({} as any, { limit: 5, page: 1, status: 'all' });

    expect(rows).toEqual([
      {
        aweme_id: '7000000000000000001',
        title: '测试视频标题',
        status: 'private',
        play_count: 0,
        digg_count: 12,
        create_time: new Date(1581571130 * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Tokyo' }),
      },
    ]);
  });
});
