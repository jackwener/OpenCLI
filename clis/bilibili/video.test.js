import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';

const { mockApiGet } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
}));

vi.mock('./utils.js', async (importOriginal) => ({
  ...(await importOriginal()),
  apiGet: mockApiGet,
}));

import { getRegistry } from '@jackwener/opencli/registry';
import './video.js';

describe('bilibili video', () => {
  const command = getRegistry().get('bilibili/video');
  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(),
  };

  beforeEach(() => {
    mockApiGet.mockReset();
    page.goto.mockClear();
    page.evaluate.mockReset();
  });

  it('returns a field/value table of video metadata on success', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: 0,
      data: {
        bvid: 'BV1xx411c7mD',
        aid: 12345678,
        title: '三层结构笔记法',
        tname: '教程',
        pubdate: 1775053078, // 2026-04-01 14:17:58 UTC
        duration: 434,
        videos: 1,
        pic: 'https://i1.hdslb.com/some.jpg',
        desc: 'Obsidian 教程',
        owner: { mid: 507578555, name: 'IOI科技' },
        stat: { view: 6128, danmaku: 0, reply: 21, like: 162, coin: 48, favorite: 564, share: 26 },
      },
    });

    const rows = await command.func(page, { bvid: 'BV1xx411c7mD' });

    // Every row has { field, value }
    expect(Array.isArray(rows)).toBe(true);
    for (const row of rows) {
      expect(row).toHaveProperty('field');
      expect(row).toHaveProperty('value');
    }

    const byField = Object.fromEntries(rows.map((r) => [r.field, r.value]));
    expect(byField.bvid).toBe('BV1xx411c7mD');
    expect(byField.title).toBe('三层结构笔记法');
    expect(byField.author).toBe('IOI科技 (mid: 507578555)');
    expect(byField.duration).toBe('7m14s (434s)');
    expect(byField.view).toBe('6128');
    expect(byField.like).toBe('162');

    // Navigation primes the session
    expect(page.goto).toHaveBeenCalledWith('https://www.bilibili.com/video/BV1xx411c7mD/');
    // API called without signing
    expect(mockApiGet).toHaveBeenCalledWith(page, '/x/web-interface/view', { params: { bvid: 'BV1xx411c7mD' } });
  });

  it('throws CommandExecutionError when bilibili view API returns non-zero code', async () => {
    mockApiGet.mockResolvedValueOnce({
      code: -404,
      message: '啥都木有',
      data: null,
    });

    await expect(command.func(page, { bvid: 'BV1xx411c7mD' })).rejects.toSatisfy(
      (err) => err instanceof CommandExecutionError && /啥都木有|-404/.test(err.message),
    );
  });
});
