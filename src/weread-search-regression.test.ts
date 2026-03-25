import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from './registry.js';
import './clis/weread/search.js';

describe('weread/search regression', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the query argument for the search API and returns urls', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        books: [
          {
            bookInfo: {
              title: 'Deep Work',
              author: 'Cal Newport',
              bookId: 'abc123',
            },
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: 'deep work', limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('keyword=deep+work');
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Deep Work',
        author: 'Cal Newport',
        bookId: 'abc123',
        url: 'https://weread.qq.com/web/bookDetail/abc123',
      },
    ]);
  });
});
