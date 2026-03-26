import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from './registry.js';
import { fetchPrivateApi } from './clis/weread/utils.js';
import './clis/weread/shelf.js';

describe('weread private API regression', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uses browser cookies and Node fetch for private API requests', async () => {
    const mockPage = {
      getCookies: vi.fn()
        .mockResolvedValueOnce([
          { name: 'wr_name', value: 'alice', domain: 'weread.qq.com' },
          { name: 'wr_vid', value: 'vid123', domain: 'i.weread.qq.com' },
        ]),
      evaluate: vi.fn(),
    } as any;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ title: 'Test Book', errcode: 0 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchPrivateApi(mockPage, '/book/info', { bookId: '123' });

    expect(result.title).toBe('Test Book');
    expect(mockPage.getCookies).toHaveBeenCalledTimes(1);
    expect(mockPage.getCookies).toHaveBeenCalledWith({ url: 'https://i.weread.qq.com/book/info?bookId=123' });
    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://i.weread.qq.com/book/info?bookId=123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'wr_name=alice; wr_vid=vid123',
        }),
      }),
    );
  });

  it('maps unauthenticated private API responses to AUTH_REQUIRED', async () => {
    const mockPage = {
      getCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn(),
    } as any;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ errcode: -2010, errmsg: '用户不存在' }),
    }));

    await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toThrow('Not logged in');
  });

  it('maps non-auth API errors to API_ERROR', async () => {
    const mockPage = {
      getCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn(),
    } as any;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ errcode: -1, errmsg: 'unknown error' }),
    }));

    await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toThrow('unknown error');
  });

  it('maps non-401 HTTP failures to FETCH_ERROR', async () => {
    const mockPage = {
      getCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn(),
    } as any;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ errmsg: 'forbidden' }),
    }));

    await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toThrow('HTTP 403');
  });

  it('maps invalid JSON to PARSE_ERROR', async () => {
    const mockPage = {
      getCookies: vi.fn().mockResolvedValue([]),
      evaluate: vi.fn(),
    } as any;

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    }));

    await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toThrow('Invalid JSON');
  });

  it('routes weread shelf through the private API helper path', async () => {
    const command = getRegistry().get('weread/shelf');
    expect(command?.func).toBeTypeOf('function');

    const mockPage = {
      getCookies: vi.fn()
        .mockResolvedValueOnce([
          { name: 'wr_name', value: 'alice', domain: 'weread.qq.com' },
          { name: 'wr_vid', value: 'vid123', domain: 'i.weread.qq.com' },
        ]),
      evaluate: vi.fn(),
    } as any;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        books: [{
          title: 'Deep Work',
          author: 'Cal Newport',
          readingProgress: 42,
          bookId: 'abc123',
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await command!.func!(mockPage, { limit: 1 });

    expect(mockPage.evaluate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0',
      expect.any(Object),
    );
    expect(mockPage.getCookies).toHaveBeenCalledWith({
      url: 'https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0',
    });
    expect(result).toEqual([
      {
        title: 'Deep Work',
        author: 'Cal Newport',
        progress: '42%',
        bookId: 'abc123',
      },
    ]);
  });
});
