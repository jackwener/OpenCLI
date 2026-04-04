import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import './search.js';

describe('weread/search regression', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the query argument for the search API and returns reader urls from search html', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/reader123"></a>
              <p class="wr_bookList_item_title">Deep Work</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: 'deep work', limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('keyword=deep+work');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/web/search/books?keyword=deep+work');
    expect(result).toEqual([
      {
        rank: 1,
        title: 'Deep Work',
        author: 'Cal Newport',
        bookId: 'abc123',
        url: 'https://weread.qq.com/web/reader/reader123',
      },
    ]);
  });

  it('does not emit stale bookDetail urls when the reader url is unavailable', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('<html><body><p>no search cards</p></body></html>'),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: 'deep work', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Deep Work',
        author: 'Cal Newport',
        bookId: 'abc123',
        url: '',
      },
    ]);
  });

  it('matches reader urls by title queue instead of assuming identical result order', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
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
            {
              bookInfo: {
                title: 'Digital Minimalism',
                author: 'Cal Newport',
                bookId: 'xyz789',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/unrelated111"></a>
              <p class="wr_bookList_item_title">Atomic Habits</p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/digital222"></a>
              <p class="wr_bookList_item_title">Digital Minimalism</p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/deep333"></a>
              <p class="wr_bookList_item_title">Deep Work</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: 'cal newport', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Deep Work',
        author: 'Cal Newport',
        bookId: 'abc123',
        url: 'https://weread.qq.com/web/reader/deep333',
      },
      {
        rank: 2,
        title: 'Digital Minimalism',
        author: 'Cal Newport',
        bookId: 'xyz789',
        url: 'https://weread.qq.com/web/reader/digital222',
      },
    ]);
  });

  it('falls back to empty urls when the search html request fails', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockRejectedValueOnce(new Error('network timeout'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: 'deep work', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: 'Deep Work',
        author: 'Cal Newport',
        bookId: 'abc123',
        url: '',
      },
    ]);
  });

  it('binds reader urls with title and author instead of title alone', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '文明',
                author: '作者甲',
                bookId: 'book-a',
              },
            },
            {
              bookInfo: {
                title: '文明',
                author: '作者乙',
                bookId: 'book-b',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-b-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author"><a href="/web/search/books?author=%E4%BD%9C%E8%80%85%E4%B9%99">作者乙</a></p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-a-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author"><a href="/web/search/books?author=%E4%BD%9C%E8%80%85%E7%94%B2">作者甲</a></p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: '文明', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: '文明',
        author: '作者甲',
        bookId: 'book-a',
        url: 'https://weread.qq.com/web/reader/book-a-reader',
      },
      {
        rank: 2,
        title: '文明',
        author: '作者乙',
        bookId: 'book-b',
        url: 'https://weread.qq.com/web/reader/book-b-reader',
      },
    ]);
  });

  it('leaves urls empty when same-title results are ambiguous and html cards have no author', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '文明',
                author: '作者甲',
                bookId: 'book-a',
              },
            },
            {
              bookInfo: {
                title: '文明',
                author: '作者乙',
                bookId: 'book-b',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-b-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-a-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: '文明', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: '文明',
        author: '作者甲',
        bookId: 'book-a',
        url: '',
      },
      {
        rank: 2,
        title: '文明',
        author: '作者乙',
        bookId: 'book-b',
        url: '',
      },
    ]);
  });

  it('leaves urls empty when exact author matching fails and multiple html cards share the same title', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '文明',
                author: '作者甲',
                bookId: 'book-a',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-a-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author"><a href="/web/search/books?author=%E4%BD%9C%E8%80%85%E4%B9%99">作者乙</a></p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-a-reader-2"></a>
              <p class="wr_bookList_item_title">文明</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: '文明', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: '文明',
        author: '作者甲',
        bookId: 'book-a',
        url: '',
      },
    ]);
  });

  it('leaves urls empty when multiple results share the same title and author identity', async () => {
    const command = getRegistry().get('weread/search');
    expect(command?.func).toBeTypeOf('function');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '文明',
                author: '作者甲',
                bookId: 'book-a',
              },
            },
            {
              bookInfo: {
                title: '文明',
                author: '作者甲',
                bookId: 'book-b',
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(`
          <ul class="search_bookDetail_list">
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-b-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author"><a href="/web/search/books?author=%E4%BD%9C%E8%80%85%E7%94%B2">作者甲</a></p>
            </li>
            <li class="wr_bookList_item">
              <a class="wr_bookList_item_link" href="/web/reader/book-a-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author"><a href="/web/search/books?author=%E4%BD%9C%E8%80%85%E7%94%B2">作者甲</a></p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(null as any, { query: '文明', limit: 5 });

    expect(result).toEqual([
      {
        rank: 1,
        title: '文明',
        author: '作者甲',
        bookId: 'book-a',
        url: '',
      },
      {
        rank: 2,
        title: '文明',
        author: '作者甲',
        bookId: 'book-b',
        url: '',
      },
    ]);
  });
});
