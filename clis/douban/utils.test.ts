import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '@jackwener/opencli/types';
import {
  getDoubanPhotoExtension,
  loadDoubanSubjectPhotos,
  normalizeDoubanSubjectId,
  promoteDoubanPhotoUrl,
  resolveDoubanPhotoAssetUrl,
} from './utils.js';

describe('douban utils', () => {
  it('normalizes valid subject ids', () => {
    expect(normalizeDoubanSubjectId(' 30382501 ')).toBe('30382501');
  });

  it('rejects invalid subject ids', () => {
    expect(() => normalizeDoubanSubjectId('tt30382501')).toThrow('Invalid Douban subject ID');
  });

  it('promotes thumbnail urls to large photo urls', () => {
    expect(
      promoteDoubanPhotoUrl('https://img1.doubanio.com/view/photo/m/public/p2913450214.webp'),
    ).toBe('https://img1.doubanio.com/view/photo/l/public/p2913450214.webp');

    expect(
      promoteDoubanPhotoUrl('https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2578474613.jpg'),
    ).toBe('https://img9.doubanio.com/view/photo/l/public/p2578474613.jpg');
  });

  it('rejects non-http photo urls during promotion', () => {
    expect(promoteDoubanPhotoUrl('data:image/gif;base64,abc')).toBe('');
  });

  it('prefers lazy-loaded photo urls over data placeholders', () => {
    expect(
      resolveDoubanPhotoAssetUrl([
        '',
        'https://img1.doubanio.com/view/photo/m/public/p2913450214.webp',
        'data:image/gif;base64,abc',
      ], 'https://movie.douban.com/subject/30382501/photos?type=Rb'),
    ).toBe('https://img1.doubanio.com/view/photo/m/public/p2913450214.webp');
  });

  it('drops unsupported non-http photo urls when no real image url exists', () => {
    expect(
      resolveDoubanPhotoAssetUrl(
        ['data:image/gif;base64,abc', 'blob:https://movie.douban.com/example'],
        'https://movie.douban.com/subject/30382501/photos?type=Rb',
      ),
    ).toBe('');
  });

  it('removes the default photo cap when scanning for an exact photo id', async () => {
    const evaluate = vi.fn()
      .mockResolvedValueOnce({ blocked: false, title: 'Some Movie', href: 'https://movie.douban.com/subject/30382501/photos?type=Rb' })
      .mockResolvedValueOnce({
        subjectId: '30382501',
        subjectTitle: 'The Wandering Earth 2',
        type: 'Rb',
        photos: [
          {
            index: 731,
            photoId: '2913450215',
            title: 'Character poster',
            imageUrl: 'https://img1.doubanio.com/view/photo/l/public/p2913450215.jpg',
            thumbUrl: 'https://img1.doubanio.com/view/photo/m/public/p2913450215.jpg',
            detailUrl: 'https://movie.douban.com/photos/photo/2913450215/',
            page: 25,
          },
        ],
      });
    const page = {
      goto: vi.fn().mockResolvedValue(undefined),
      wait: vi.fn().mockResolvedValue(undefined),
      evaluate,
    } as unknown as IPage;

    await loadDoubanSubjectPhotos(page, '30382501', {
      type: 'Rb',
      targetPhotoId: '2913450215',
    });

    const scanScript = evaluate.mock.calls[1]?.[0];
    expect(scanScript).toContain('const targetPhotoId = "2913450215";');
    expect(scanScript).toContain(`const limit = ${Number.MAX_SAFE_INTEGER};`);
    expect(scanScript).toContain('for (let pageIndex = 0; photos.length < limit; pageIndex += 1)');
  });

  it('keeps image extensions when download urls contain query params', () => {
    expect(
      getDoubanPhotoExtension('https://img1.doubanio.com/view/photo/l/public/p2913450214.webp?foo=1'),
    ).toBe('.webp');
    expect(
      getDoubanPhotoExtension('https://img1.doubanio.com/view/photo/l/public/p2913450214.jpeg'),
    ).toBe('.jpeg');
  });
});
