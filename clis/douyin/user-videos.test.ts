import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchDouyinUserVideosMock, fetchDouyinCommentsMock } = vi.hoisted(() => ({
  fetchDouyinUserVideosMock: vi.fn(),
  fetchDouyinCommentsMock: vi.fn(),
}));

vi.mock('./_shared/public-api.js', () => ({
  fetchDouyinUserVideos: fetchDouyinUserVideosMock,
  fetchDouyinComments: fetchDouyinCommentsMock,
}));

import { getRegistry } from '../../src/registry.js';
import { DEFAULT_COMMENT_LIMIT, MAX_USER_VIDEOS_LIMIT, normalizeCommentLimit, normalizeUserVideosLimit } from './user-videos.js';

describe('douyin user-videos', () => {
  beforeEach(() => {
    fetchDouyinUserVideosMock.mockReset();
    fetchDouyinCommentsMock.mockReset();
  });

  it('registers the command', () => {
    const registry = getRegistry();
    const values = [...registry.values()];
    const command = values.find((cmd) => cmd.site === 'douyin' && cmd.name === 'user-videos');
    expect(command).toBeDefined();
  });

  it('clamps limit to a safe maximum', () => {
    expect(normalizeUserVideosLimit(100)).toBe(MAX_USER_VIDEOS_LIMIT);
    expect(normalizeUserVideosLimit(0)).toBe(1);
    expect(normalizeCommentLimit(99)).toBe(DEFAULT_COMMENT_LIMIT);
  });

  it('uses shared public-api helpers and applies clamped limits', async () => {
    const registry = getRegistry();
    const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'user-videos');
    expect(command?.func).toBeDefined();
    if (!command?.func) throw new Error('douyin user-videos command not registered');

    fetchDouyinUserVideosMock.mockResolvedValueOnce([
      {
        aweme_id: '1',
        desc: 'test video',
        video: { duration: 1234, play_addr: { url_list: ['https://example.com/video.mp4'] } },
        statistics: { digg_count: 9 },
      },
    ]);
    fetchDouyinCommentsMock.mockResolvedValueOnce([
      { text: 'nice', digg_count: 3, nickname: 'alice' },
    ]);

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    const rows = await command.func(page as any, {
      sec_uid: 'MS4w-test',
      limit: 100,
      comment_limit: 99,
      with_comments: true,
    });

    expect(fetchDouyinUserVideosMock).toHaveBeenCalledWith(page, 'MS4w-test', MAX_USER_VIDEOS_LIMIT);
    expect(fetchDouyinCommentsMock).toHaveBeenCalledWith(page, '1', DEFAULT_COMMENT_LIMIT);
    expect(rows).toEqual([
      {
        index: 1,
        aweme_id: '1',
        title: 'test video',
        duration: 1,
        digg_count: 9,
        play_url: 'https://example.com/video.mp4',
        top_comments: [
          { text: 'nice', digg_count: 3, nickname: 'alice' },
        ],
      },
    ]);
  });

  it('skips comment enrichment when with_comments is false', async () => {
    const registry = getRegistry();
    const command = [...registry.values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'user-videos');
    expect(command?.func).toBeDefined();
    if (!command?.func) throw new Error('douyin user-videos command not registered');

    fetchDouyinUserVideosMock.mockResolvedValueOnce([
      {
        aweme_id: '2',
        desc: 'plain video',
        video: { duration: 2000, play_addr: { url_list: ['https://example.com/plain.mp4'] } },
        statistics: { digg_count: 1 },
      },
    ]);

    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
    };

    const rows = await command.func(page as any, {
      sec_uid: 'MS4w-test',
      limit: 3,
      with_comments: false,
      comment_limit: 5,
    });

    expect(fetchDouyinCommentsMock).not.toHaveBeenCalled();
    expect(rows).toEqual([
      {
        index: 1,
        aweme_id: '2',
        title: 'plain video',
        duration: 2,
        digg_count: 1,
        play_url: 'https://example.com/plain.mp4',
        top_comments: [],
      },
    ]);
  });
});
