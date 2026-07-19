import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';

const { mockHttpDownload, mockMkdirSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('@jackwener/opencli/download', () => ({
  formatCookieHeader: vi.fn().mockReturnValue('cookie=value'),
  httpDownload: mockHttpDownload,
}));
vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
}));

await import('./bookmark-download.js');

let cmd;

beforeAll(() => {
  cmd = getRegistry().get('pixiv/bookmark-download');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pixiv bookmark-download', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
  });

  it('downloads current account illustration bookmarks using original image URLs', async () => {
    mockHttpDownload.mockResolvedValue({ success: true, size: 1000 });
    const page = createPageMock([
      { id: '37119297' },
      { body: { works: [{ id: '12345', title: '星空', userName: '作者A', userId: '100', pageCount: 1, tags: [] }] } },
      { body: [{ urls: { original: 'https://i.pximg.net/img-original/img/12345_p0.png' } }] },
    ]);

    const result = await cmd.func(page, { type: 'illust', limit: 1, output: '/tmp/pixiv' });

    expect(mockHttpDownload).toHaveBeenCalledTimes(1);
    expect(mockHttpDownload.mock.calls[0][0]).toContain('12345_p0.png');
    expect(mockHttpDownload.mock.calls[0][2].headers).toEqual({ Referer: 'https://www.pixiv.net/' });
    expect(result).toEqual([{ rank: 1, type: 'illust', id: '12345', title: '星空', status: 'success', download_status: 'success', path: '/tmp/pixiv/illust/12345' }]);
  });

  it('downloads current account novel bookmarks as text files', async () => {
    const page = createPageMock([
      { id: '37119297' },
      { body: { works: [{ id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200', tags: [] }] } },
      { body: { id: '10588915', title: '星之观测手记', userName: '作者B', userId: '200', content: '正文', tags: { tags: [] } } },
    ]);

    const result = await cmd.func(page, { type: 'novel', limit: 1, output: '/tmp/pixiv', format: 'txt' });

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync.mock.calls[0][1]).toContain('正文');
    expect(result[0]).toMatchObject({ rank: 1, type: 'novel', id: '10588915', title: '星之观测手记', status: 'success' });
  });

  it('records per-item failures and continues', async () => {
    mockHttpDownload.mockRejectedValueOnce(new Error('network down'));
    const page = createPageMock([
      { id: '37119297' },
      { body: { works: [{ id: '12345', title: '星空', userName: '作者A', userId: '100', tags: [] }] } },
      { body: [{ urls: { original: 'https://i.pximg.net/img-original/img/12345_p0.png' } }] },
    ]);

    const result = await cmd.func(page, { type: 'illust', limit: 1, output: '/tmp/pixiv' });
    expect(result[0]).toMatchObject({ status: 'failed' });
    expect(result[0].error).toContain('network down');
  });

  it('fails before writing paths when bookmark IDs are malformed', async () => {
    const page = createPageMock([
      { id: '37119297' },
      { body: { works: [{ id: '../escape', title: '星空', userName: '作者A', userId: '100', tags: [] }] } },
    ]);

    await expect(cmd.func(page, { type: 'illust', limit: 1, output: '/tmp/pixiv' })).rejects.toThrow(CommandExecutionError);
    expect(mockMkdirSync).not.toHaveBeenCalled();
    expect(mockHttpDownload).not.toHaveBeenCalled();
  });

  it('throws ArgumentError on invalid type before navigation', async () => {
    const page = createPageMock([]);
    await expect(cmd.func(page, { type: 'music' })).rejects.toThrow(ArgumentError);
    expect(page.goto).not.toHaveBeenCalled();
  });
});
