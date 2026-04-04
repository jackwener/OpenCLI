import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '../../src/errors.js';

const { mockFetchPrivateApi } = vi.hoisted(() => ({
  mockFetchPrivateApi: vi.fn(),
}));

vi.mock('./utils.js', async () => {
  const actual = await vi.importActual<typeof import('./utils.js')>('./utils.js');
  return {
    ...actual,
    fetchPrivateApi: mockFetchPrivateApi,
  };
});

import { getRegistry } from '../../src/registry.js';
import './book.js';
import './highlights.js';
import './notes.js';

describe('weread book-id positional args', () => {
  const book = getRegistry().get('weread/book');
  const highlights = getRegistry().get('weread/highlights');
  const notes = getRegistry().get('weread/notes');

  const repeatValue = <T,>(value: T, count: number): T[] => Array.from({ length: count }, () => value);

  const createPageStub = (...evaluateResults: unknown[]) => ({
    getCookies: vi.fn().mockResolvedValue([
      { name: 'wr_vid', value: '70486028', domain: '.weread.qq.com' },
    ]),
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockImplementation(async () => evaluateResults.shift()),
  });

  beforeEach(() => {
    mockFetchPrivateApi.mockReset();
    vi.unstubAllGlobals();
  });

  it('passes the positional book-id to book details', async () => {
    mockFetchPrivateApi.mockResolvedValue({ title: 'Three Body', newRating: 880 });

    await book!.func!({} as any, { 'book-id': '12345' });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/info', { bookId: '12345' });
  });

  it('falls back to the shelf reader page when private API auth has expired', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = createPageStub(
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'MP_WXS_3634777637', title: '文明、现代化、价值投资与中国', author: '李录' },
        ],
        shelfIndexes: [
          { bookId: 'MP_WXS_3634777637', idx: 0, role: 'book' },
        ],
      },
      ['https://weread.qq.com/web/reader/6f5323f071bd7f7b6f521e8'],
      {
        title: '文明、现代化、价值投资与中国',
        author: '李录',
        publisher: '中信出版集团',
        intro: '对中国未来几十年的预测。',
        category: '',
        rating: '84.1%',
        metadataReady: true,
      },
    ) as any;

    const result = await book!.func!(page, { 'book-id': 'MP_WXS_3634777637' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/6f5323f071bd7f7b6f521e8');
    expect(page.evaluate).toHaveBeenCalledTimes(3);
    expect(result).toEqual([
      {
        title: '文明、现代化、价值投资与中国',
        author: '李录',
        publisher: '中信出版集团',
        intro: '对中国未来几十年的预测。',
        category: '',
        rating: '84.1%',
      },
    ]);
  });

  it('keeps mixed shelf entries aligned when resolving MP_WXS reader urls', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = createPageStub(
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'MP_WXS_1', title: '公众号文章一', author: '作者甲' },
          { bookId: 'BOOK_2', title: '普通书二', author: '作者乙' },
          { bookId: 'MP_WXS_3', title: '公众号文章三', author: '作者丙' },
        ],
        shelfIndexes: [
          { bookId: 'MP_WXS_1', idx: 0, role: 'mp' },
          { bookId: 'BOOK_2', idx: 1, role: 'book' },
          { bookId: 'MP_WXS_3', idx: 2, role: 'mp' },
        ],
      },
      [
        'https://weread.qq.com/web/reader/mp1',
        'https://weread.qq.com/web/reader/book2',
        'https://weread.qq.com/web/reader/mp3',
      ],
      {
        title: '公众号文章一',
        author: '作者甲',
        publisher: '微信读书',
        intro: '第一篇文章。',
        category: '',
        rating: '',
        metadataReady: true,
      },
    ) as any;

    const result = await book!.func!(page, { 'book-id': 'MP_WXS_1' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/mp1');
    expect(result).toEqual([
      {
        title: '公众号文章一',
        author: '作者甲',
        publisher: '微信读书',
        intro: '第一篇文章。',
        category: '',
        rating: '',
      },
    ]);
  });

  it('rethrows AUTH_REQUIRED when shelf ordering is incomplete and reader urls cannot be trusted', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));

    const page = createPageStub(
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
          { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
        ],
        shelfIndexes: [
          { bookId: 'BOOK_2', idx: 0, role: 'book' },
        ],
      },
      [
        'https://weread.qq.com/web/reader/book2',
        'https://weread.qq.com/web/reader/book1',
      ],
    ) as any;

    await expect(book!.func!(page, { 'book-id': 'BOOK_1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Not logged in to WeRead',
    });
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
  });

  it('falls back to the public search page when a cached ordinary book has no trusted shelf reader url', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '数据化运营：系统方法与实践案例',
                author: '赵宏田 江丽萍 李宁',
                bookId: '22920382',
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
              <a class="wr_bookList_item_link" href="/web/reader/book229"></a>
              <p class="wr_bookList_item_title">数据化运营：系统方法与实践案例</p>
              <p class="wr_bookList_item_author">赵宏田 江丽萍 李宁</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const staleSnapshot = {
      cacheFound: true,
      rawBooks: [
        { bookId: '22920382', title: '数据化运营：系统方法与实践案例', author: '赵宏田 江丽萍 李宁' },
      ],
      shelfIndexes: [
        { bookId: 'stale-entry', idx: 0, role: 'book' },
      ],
    };
    const page = createPageStub(
      ...repeatValue(staleSnapshot, 2),
      {
        title: '数据化运营：系统方法与实践案例',
        author: '赵宏田 江丽萍 李宁',
        publisher: '电子工业出版社',
        intro: '一本关于数据化运营的方法论书籍。',
        category: '',
        rating: '',
        metadataReady: true,
      },
    ) as any;

    const result = await book!.func!(page, { 'book-id': '22920382' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/web/search/global?keyword=');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/web/search/books?keyword=');
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/book229');
    expect(result).toEqual([
      {
        title: '数据化运营：系统方法与实践案例',
        author: '赵宏田 江丽萍 李宁',
        publisher: '电子工业出版社',
        intro: '一本关于数据化运营的方法论书籍。',
        category: '',
        rating: '',
      },
    ]);
  });

  it('rethrows AUTH_REQUIRED when search fallback finds the same title with a different visible author', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          books: [
            {
              bookInfo: {
                title: '文明',
                author: '作者乙',
                bookId: 'wrong-book',
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
              <a class="wr_bookList_item_link" href="/web/reader/wrong-reader"></a>
              <p class="wr_bookList_item_title">文明</p>
              <p class="wr_bookList_item_author">作者乙</p>
            </li>
          </ul>
        `),
      });
    vi.stubGlobal('fetch', fetchMock);

    const staleSnapshot = {
      cacheFound: true,
      rawBooks: [
        { bookId: 'BOOK_1', title: '文明', author: '作者甲' },
      ],
      shelfIndexes: [
        { bookId: 'stale-entry', idx: 0, role: 'book' },
      ],
    };
    const page = createPageStub(
      ...repeatValue(staleSnapshot, 2),
    ) as any;

    await expect(book!.func!(page, { 'book-id': 'BOOK_1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Not logged in to WeRead',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
  });

  it('falls back to raw cache order when shelf indexes never hydrate but rendered reader urls cover every cached entry', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network disabled')));

    const emptyIndexSnapshot = {
      cacheFound: true,
      rawBooks: [
        { bookId: '22920382', title: '数据化运营：系统方法与实践案例', author: '赵宏田 江丽萍 李宁' },
        { bookId: 'MP_WXS_3634777637', title: '方伟看10年', author: '公众号' },
      ],
      shelfIndexes: [],
    };
    const page = createPageStub(
      ...repeatValue(emptyIndexSnapshot, 2),
      [
        'https://weread.qq.com/web/reader/book229',
        'https://weread.qq.com/web/reader/mp3634',
      ],
      {
        title: '方伟看10年',
        author: '公众号',
        publisher: '',
        intro: '公众号文章详情。',
        category: '',
        rating: '',
        metadataReady: true,
      },
    ) as any;

    const result = await book!.func!(page, { 'book-id': 'MP_WXS_3634777637' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/mp3634');
    expect(result).toEqual([
      {
        title: '方伟看10年',
        author: '公众号',
        publisher: '',
        intro: '公众号文章详情。',
        category: '',
        rating: '',
      },
    ]);
  });

  it('waits for shelf indexes to hydrate before resolving a trusted reader url', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = createPageStub(
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
          { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
        ],
        shelfIndexes: [
          { bookId: 'BOOK_2', idx: 0, role: 'book' },
        ],
      },
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
          { bookId: 'BOOK_2', title: '第二本', author: '作者乙' },
        ],
        shelfIndexes: [
          { bookId: 'BOOK_2', idx: 0, role: 'book' },
          { bookId: 'BOOK_1', idx: 1, role: 'book' },
        ],
      },
      [
        'https://weread.qq.com/web/reader/book2',
        'https://weread.qq.com/web/reader/book1',
      ],
      {
        title: '第一本',
        author: '作者甲',
        publisher: '出版社甲',
        intro: '简介甲',
        category: '',
        rating: '',
        metadataReady: true,
      },
    ) as any;

    const result = await book!.func!(page, { 'book-id': 'BOOK_1' });

    expect(page.goto).toHaveBeenNthCalledWith(1, 'https://weread.qq.com/web/shelf');
    expect(page.goto).toHaveBeenNthCalledWith(2, 'https://weread.qq.com/web/reader/book1');
    expect(result).toEqual([
      {
        title: '第一本',
        author: '作者甲',
        publisher: '出版社甲',
        intro: '简介甲',
        category: '',
        rating: '',
      },
    ]);
  });

  it('rethrows AUTH_REQUIRED when the reader page lacks stable cover metadata', async () => {
    mockFetchPrivateApi.mockRejectedValue(
      new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first'),
    );

    const page = createPageStub(
      {
        cacheFound: true,
        rawBooks: [
          { bookId: 'BOOK_1', title: '第一本', author: '作者甲' },
        ],
        shelfIndexes: [
          { bookId: 'BOOK_1', idx: 0, role: 'book' },
        ],
      },
      [
        'https://weread.qq.com/web/reader/book1',
      ],
      {
        title: '',
        author: '',
        publisher: '',
        intro: '这是正文第一段，不应该被当成简介。',
        category: '',
        rating: '',
        metadataReady: false,
      },
    ) as any;

    await expect(book!.func!(page, { 'book-id': 'BOOK_1' })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
      message: 'Not logged in to WeRead',
    });
  });

  it('passes the positional book-id to highlights', async () => {
    mockFetchPrivateApi.mockResolvedValue({ updated: [] });

    await highlights!.func!({} as any, { 'book-id': 'abc', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/book/bookmarklist', { bookId: 'abc' });
  });

  it('passes the positional book-id to notes', async () => {
    mockFetchPrivateApi.mockResolvedValue({ reviews: [] });

    await notes!.func!({} as any, { 'book-id': 'xyz', limit: 5 });

    expect(mockFetchPrivateApi).toHaveBeenCalledWith({}, '/review/list', {
      bookId: 'xyz',
      listType: '11',
      mine: '1',
      synckey: '0',
    });
  });
});
