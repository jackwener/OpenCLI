import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildWebShelfEntries, formatDate, fetchWebApi } from './utils.js';

describe('formatDate', () => {
  it('formats a typical Unix timestamp in UTC+8', () => {
    // 1705276800 = 2024-01-15 00:00:00 UTC = 2024-01-15 08:00:00 Beijing
    expect(formatDate(1705276800)).toBe('2024-01-15');
  });

  it('handles UTC midnight edge case with UTC+8 offset', () => {
    // 1705190399 = 2024-01-13 23:59:59 UTC = 2024-01-14 07:59:59 Beijing
    expect(formatDate(1705190399)).toBe('2024-01-14');
  });

  it('returns dash for zero', () => {
    expect(formatDate(0)).toBe('-');
  });

  it('returns dash for negative', () => {
    expect(formatDate(-1)).toBe('-');
  });

  it('returns dash for NaN', () => {
    expect(formatDate(NaN)).toBe('-');
  });

  it('returns dash for Infinity', () => {
    expect(formatDate(Infinity)).toBe('-');
  });

  it('returns dash for undefined', () => {
    expect(formatDate(undefined)).toBe('-');
  });

  it('returns dash for null', () => {
    expect(formatDate(null)).toBe('-');
  });
});

describe('fetchWebApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed JSON for successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ books: [{ title: 'Test' }] }),
    }));

    const result = await fetchWebApi('/search/global', { keyword: 'test' });
    expect(result).toEqual({ books: [{ title: 'Test' }] });
  });

  it('throws CliError on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({}),
    }));

    await expect(fetchWebApi('/search/global')).rejects.toThrow('HTTP 403');
  });

  it('throws PARSE_ERROR on non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }));

    await expect(fetchWebApi('/search/global')).rejects.toThrow('Invalid JSON');
  });
});

describe('buildWebShelfEntries', () => {
  it('keeps mixed shelf item reader urls aligned when shelf indexes include non-book roles', () => {
    const result = buildWebShelfEntries(
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
    );

    expect(result).toEqual([
      {
        bookId: 'MP_WXS_1',
        title: '公众号文章一',
        author: '作者甲',
        readerUrl: 'https://weread.qq.com/web/reader/mp1',
      },
      {
        bookId: 'BOOK_2',
        title: '普通书二',
        author: '作者乙',
        readerUrl: 'https://weread.qq.com/web/reader/book2',
      },
      {
        bookId: 'MP_WXS_3',
        title: '公众号文章三',
        author: '作者丙',
        readerUrl: 'https://weread.qq.com/web/reader/mp3',
      },
    ]);
  });

  it('falls back to raw cache order when shelf indexes are incomplete', () => {
    const result = buildWebShelfEntries(
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
        'https://weread.qq.com/web/reader/book1',
        'https://weread.qq.com/web/reader/book2',
      ],
    );

    expect(result).toEqual([
      {
        bookId: 'BOOK_1',
        title: '第一本',
        author: '作者甲',
        readerUrl: 'https://weread.qq.com/web/reader/book1',
      },
      {
        bookId: 'BOOK_2',
        title: '第二本',
        author: '作者乙',
        readerUrl: 'https://weread.qq.com/web/reader/book2',
      },
    ]);
  });
});
