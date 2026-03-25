import { describe, expect, it } from 'vitest';
import { getRegistry } from '../../registry.js';
import { createPageMock } from './test-utils.js';
import './search.js';

describe('pixiv search', () => {
  it('throws AuthRequiredError on HTTP error', async () => {
    const cmd = getRegistry().get('pixiv/search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([{ error: 401 }]);

    await expect(cmd!.func!(page, { query: '初音ミク', limit: 5 })).rejects.toThrow(
      'HTTP 401'
    );
  });

  it('returns ranked results with correct fields', async () => {
    const cmd = getRegistry().get('pixiv/search');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([
      {
        body: {
          illust: {
            data: [
              {
                id: '12345',
                title: 'Miku Illustration',
                userName: 'artist1',
                userId: '100',
                pageCount: 3,
                bookmarkCount: 500,
                tags: ['初音ミク', 'VOCALOID', 'ミク'],
              },
              {
                id: '67890',
                title: 'Another Art',
                userName: 'artist2',
                userId: '200',
                pageCount: 1,
                bookmarkCount: 100,
                tags: ['オリジナル'],
              },
            ],
          },
        },
      },
    ]);

    const result = (await cmd!.func!(page, { query: '初音ミク', limit: 10 })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      rank: 1,
      title: 'Miku Illustration',
      author: 'artist1',
      illust_id: '12345',
      pages: 3,
      bookmarks: 500,
    });
    expect(result[1]).toMatchObject({ rank: 2, illust_id: '67890' });
  });

  it('respects the limit parameter', async () => {
    const cmd = getRegistry().get('pixiv/search');

    const page = createPageMock([
      {
        body: {
          illust: {
            data: [
              { id: '1', title: 'A', userName: 'u1', userId: '1', pageCount: 1, bookmarkCount: 0, tags: [] },
              { id: '2', title: 'B', userName: 'u2', userId: '2', pageCount: 1, bookmarkCount: 0, tags: [] },
              { id: '3', title: 'C', userName: 'u3', userId: '3', pageCount: 1, bookmarkCount: 0, tags: [] },
            ],
          },
        },
      },
    ]);

    const result = (await cmd!.func!(page, { query: 'test', limit: 2 })) as any[];
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no results', async () => {
    const cmd = getRegistry().get('pixiv/search');

    const page = createPageMock([{ body: { illust: { data: [] } } }]);

    const result = await cmd!.func!(page, { query: 'nonexistent', limit: 10 });
    expect(result).toEqual([]);
  });
});
