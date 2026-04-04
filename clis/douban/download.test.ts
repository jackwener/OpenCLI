import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import type { CliCommand } from '../../src/registry.js';
import { getRegistry } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

const { mockHttpDownload, mockLoadDoubanSubjectPhotos, mockMkdirSync } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockLoadDoubanSubjectPhotos: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('../../download/index.js', () => ({
  httpDownload: mockHttpDownload,
  sanitizeFilename: vi.fn((value: string) => value.replace(/\s+/g, '_')),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    loadDoubanSubjectPhotos: mockLoadDoubanSubjectPhotos,
  };
});

vi.mock('../../download/progress.js', () => ({
  formatBytes: vi.fn((size: number) => `${size} B`),
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
}));

await import('./download.js');

let cmd: CliCommand;

beforeAll(() => {
  cmd = getRegistry().get('douban/download')!;
  expect(cmd?.func).toBeTypeOf('function');
});

function toPosixPath(value: string): string {
  return value.replaceAll(path.sep, '/');
}

describe('douban download', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockLoadDoubanSubjectPhotos.mockReset();
    mockMkdirSync.mockReset();
  });

  it('downloads douban poster images and merges metadata into the result', async () => {
    const page = {} as IPage;
    mockLoadDoubanSubjectPhotos.mockResolvedValue({
      subjectId: '30382501',
      subjectTitle: 'The Wandering Earth 2',
      type: 'Rb',
      photos: [
        {
          index: 1,
          photoId: '2913450214',
          title: 'Main poster',
          imageUrl: 'https://img1.doubanio.com/view/photo/l/public/p2913450214.webp',
          thumbUrl: 'https://img1.doubanio.com/view/photo/m/public/p2913450214.webp',
          detailUrl: 'https://movie.douban.com/photos/photo/2913450214/',
          page: 1,
        },
        {
          index: 2,
          photoId: '2913450215',
          title: 'Character poster',
          imageUrl: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
          thumbUrl: 'https://img1.doubanio.com/view/photo/m/public/p2913450215.jpg',
          detailUrl: 'https://movie.douban.com/photos/photo/2913450215/',
          page: 1,
        },
      ],
    });

    mockHttpDownload
      .mockResolvedValueOnce({ success: true, size: 1200 })
      .mockResolvedValueOnce({ success: true, size: 980 });

    const result = await cmd.func!(page, {
      id: '30382501',
      type: 'Rb',
      limit: 20,
      output: '/tmp/douban-test',
    }) as Array<Record<string, unknown>>;

    expect(mockLoadDoubanSubjectPhotos).toHaveBeenCalledWith(page, '30382501', {
      type: 'Rb',
      limit: 20,
    });
    expect(mockMkdirSync).toHaveBeenCalledTimes(1);
    expect(toPosixPath(mockMkdirSync.mock.calls[0][0])).toBe('/tmp/douban-test/30382501');
    expect(mockMkdirSync.mock.calls[0][1]).toEqual({ recursive: true });
    expect(mockHttpDownload).toHaveBeenCalledTimes(2);
    expect(mockHttpDownload.mock.calls[0]?.[0]).toBe('https://img1.doubanio.com/view/photo/l/public/p2913450214.webp');
    expect(toPosixPath(mockHttpDownload.mock.calls[0]?.[1])).toBe('/tmp/douban-test/30382501/30382501_001_2913450214_Main_poster.webp');
    expect(mockHttpDownload.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      headers: { Referer: 'https://movie.douban.com/photos/photo/2913450214/' },
      timeout: 60000,
    }));
    expect(mockHttpDownload.mock.calls[1]?.[0]).toBe('https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg');
    expect(toPosixPath(mockHttpDownload.mock.calls[1]?.[1])).toBe('/tmp/douban-test/30382501/30382501_002_2913450215_Character_poster.jpg');
    expect(mockHttpDownload.mock.calls[1]?.[2]).toEqual(expect.objectContaining({
      headers: { Referer: 'https://movie.douban.com/photos/photo/2913450215/' },
      timeout: 60000,
    }));

    expect(result).toEqual([
      {
        index: 1,
        title: 'Main poster',
        photo_id: '2913450214',
        image_url: 'https://img1.doubanio.com/view/photo/l/public/p2913450214.webp',
        detail_url: 'https://movie.douban.com/photos/photo/2913450214/',
        status: 'success',
        size: '1200 B',
      },
      {
        index: 2,
        title: 'Character poster',
        photo_id: '2913450215',
        image_url: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
        detail_url: 'https://movie.douban.com/photos/photo/2913450215/',
        status: 'success',
        size: '980 B',
      },
    ]);
  });

  it('downloads only the requested photo when photo-id is provided', async () => {
    const page = {} as IPage;
    mockLoadDoubanSubjectPhotos.mockResolvedValue({
      subjectId: '30382501',
      subjectTitle: 'The Wandering Earth 2',
      type: 'Rb',
      photos: [
        {
          index: 2,
          photoId: '2913450215',
          title: 'Character poster',
          imageUrl: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
          thumbUrl: 'https://img1.doubanio.com/view/photo/m/public/p2913450215.jpg',
          detailUrl: 'https://movie.douban.com/photos/photo/2913450215/',
          page: 1,
        },
      ],
    });

    mockHttpDownload.mockResolvedValueOnce({ success: true, size: 980 });

    const result = await cmd.func!(page, {
      id: '30382501',
      type: 'Rb',
      'photo-id': '2913450215',
      output: '/tmp/douban-test',
    }) as Array<Record<string, unknown>>;

    expect(mockLoadDoubanSubjectPhotos).toHaveBeenCalledWith(page, '30382501', {
      type: 'Rb',
      targetPhotoId: '2913450215',
    });
    expect(mockHttpDownload).toHaveBeenCalledTimes(1);
    expect(mockHttpDownload.mock.calls[0]?.[0]).toBe('https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg');
    expect(toPosixPath(mockHttpDownload.mock.calls[0]?.[1])).toBe('/tmp/douban-test/30382501/30382501_002_2913450215_Character_poster.jpg');
    expect(mockHttpDownload.mock.calls[0]?.[2]).toEqual(expect.objectContaining({
      headers: { Referer: 'https://movie.douban.com/photos/photo/2913450215/' },
      timeout: 60000,
    }));

    expect(result).toEqual([
      {
        index: 2,
        title: 'Character poster',
        photo_id: '2913450215',
        image_url: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
        detail_url: 'https://movie.douban.com/photos/photo/2913450215/',
        status: 'success',
        size: '980 B',
      },
    ]);
  });

  it('rejects invalid subject ids before attempting browser work', async () => {
    await expect(
      cmd.func!({} as IPage, { id: 'movie-30382501' }),
    ).rejects.toThrow('Invalid Douban subject ID');

    expect(mockHttpDownload).not.toHaveBeenCalled();
  });
});
