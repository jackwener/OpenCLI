import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { log } from '@jackwener/opencli/logger';
import { fetchPrivateApi } from './utils.js';
import './shelf.js';
describe('weread private API regression', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });
    it('uses browser cookies and Node fetch for private API requests', async () => {
        const mockPage = {
            getCookies: vi.fn()
                .mockResolvedValueOnce([
                { name: 'wr_vid', value: 'vid123', domain: 'i.weread.qq.com' },
            ])
                .mockResolvedValueOnce([
                { name: 'wr_name', value: 'alice', domain: 'weread.qq.com' },
            ]),
            evaluate: vi.fn(),
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ title: 'Test Book', errcode: 0 }),
        });
        vi.stubGlobal('fetch', fetchMock);
        const result = await fetchPrivateApi(mockPage, '/book/info', { bookId: '123' });
        expect(result.title).toBe('Test Book');
        expect(mockPage.getCookies).toHaveBeenCalledTimes(2);
        expect(mockPage.getCookies).toHaveBeenCalledWith({ url: 'https://i.weread.qq.com/book/info?bookId=123' });
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(mockPage.evaluate).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith('https://i.weread.qq.com/book/info?bookId=123', expect.objectContaining({
            headers: expect.objectContaining({
                Cookie: 'wr_name=alice; wr_vid=vid123',
            }),
        }));
    });
    it('merges host-only main-domain cookies into private API requests', async () => {
        // Simulates host-only cookies on weread.qq.com that don't match i.weread.qq.com by URL
        const mockPage = {
            getCookies: vi.fn()
                .mockResolvedValueOnce([]) // URL lookup returns nothing for i.weread.qq.com
                .mockResolvedValueOnce([
                { name: 'wr_skey', value: 'skey-host', domain: 'weread.qq.com' },
                { name: 'wr_vid', value: 'vid-host', domain: 'weread.qq.com' },
            ]),
            evaluate: vi.fn(),
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ title: 'Book', errcode: 0 }),
        });
        vi.stubGlobal('fetch', fetchMock);
        await fetchPrivateApi(mockPage, '/book/info', { bookId: '42' });
        expect(mockPage.getCookies).toHaveBeenCalledTimes(2);
        expect(mockPage.getCookies).toHaveBeenCalledWith({ url: 'https://i.weread.qq.com/book/info?bookId=42' });
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(fetchMock).toHaveBeenCalledWith('https://i.weread.qq.com/book/info?bookId=42', expect.objectContaining({
            headers: expect.objectContaining({
                Cookie: 'wr_skey=skey-host; wr_vid=vid-host',
            }),
        }));
    });
    it('prefers API-subdomain cookies over main-domain cookies on name collision', async () => {
        const mockPage = {
            getCookies: vi.fn()
                .mockResolvedValueOnce([
                { name: 'wr_skey', value: 'from-api', domain: 'i.weread.qq.com' },
            ])
                .mockResolvedValueOnce([
                { name: 'wr_skey', value: 'from-main', domain: 'weread.qq.com' },
                { name: 'wr_vid', value: 'vid-main', domain: 'weread.qq.com' },
            ]),
            evaluate: vi.fn(),
        };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ title: 'Book', errcode: 0 }),
        });
        vi.stubGlobal('fetch', fetchMock);
        await fetchPrivateApi(mockPage, '/book/info', { bookId: '99' });
        expect(fetchMock).toHaveBeenCalledWith('https://i.weread.qq.com/book/info?bookId=99', expect.objectContaining({
            headers: expect.objectContaining({
                Cookie: 'wr_skey=from-api; wr_vid=vid-main',
            }),
        }));
    });
    it('maps unauthenticated private API responses to AUTH_REQUIRED', async () => {
        const mockPage = {
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn(),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ errcode: -2010, errmsg: '用户不存在' }),
        }));
        await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toThrow('Not logged in');
    });
    it('maps auth-expired API error codes to AUTH_REQUIRED even on HTTP 200', async () => {
        const mockPage = {
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn(),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        await expect(fetchPrivateApi(mockPage, '/book/info')).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: 'Not logged in to WeRead',
        });
    });
    it('maps non-auth API errors to API_ERROR', async () => {
        const mockPage = {
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn(),
        };
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
        };
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
        };
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
                { name: 'wr_vid', value: 'vid123', domain: 'i.weread.qq.com' },
            ])
                .mockResolvedValueOnce([
                { name: 'wr_name', value: 'alice', domain: 'weread.qq.com' },
            ]),
            evaluate: vi.fn(),
        };
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
        const result = await command.func(mockPage, { limit: 1 });
        expect(mockPage.evaluate).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith('https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0', expect.any(Object));
        expect(mockPage.getCookies).toHaveBeenCalledTimes(2);
        expect(mockPage.getCookies).toHaveBeenCalledWith({
            url: 'https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0',
        });
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(result).toEqual([
            {
                title: 'Deep Work',
                author: 'Cal Newport',
                progress: '42%',
                bookId: 'abc123',
            },
        ]);
    });
    it('falls back to structured shelf cache when the private API reports AUTH_REQUIRED', async () => {
        const command = getRegistry().get('weread/shelf');
        expect(command?.func).toBeTypeOf('function');
        const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => { });
        const mockPage = {
            getCookies: vi.fn()
                // fetchPrivateApi: URL lookup (i.weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // fetchPrivateApi: domain lookup (weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // loadWebShelfSnapshot: domain lookup for wr_vid
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid-current', domain: '.weread.qq.com' }]),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockImplementation(async (source) => {
                expect(source).toContain('shelf:rawBooks:vid-current');
                expect(source).toContain('shelf:shelfIndexes:vid-current');
                return {
                    cacheFound: true,
                    rawBooks: [
                        {
                            bookId: '40055543',
                            title: '置身事内：中国政府与经济发展',
                            author: '兰小欢',
                        },
                        {
                            bookId: '29196155',
                            title: '文明、现代化、价值投资与中国',
                            author: '李录',
                        },
                    ],
                    shelfIndexes: [
                        { bookId: '29196155', idx: 0, role: 'book' },
                        { bookId: '40055543', idx: 1, role: 'book' },
                    ],
                    lastChapters: {
                        '29196155': 40,
                        '40055543': 60,
                    },
                };
            }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        const result = await command.func(mockPage, { limit: 1 });
        expect(mockPage.goto).toHaveBeenCalledWith('https://weread.qq.com/web/shelf');
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(mockPage.evaluate).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith('WeRead private API auth expired; showing cached shelf data from localStorage. Results may be stale, and detail commands may still require re-login.');
        expect(result).toEqual([
            {
                title: '文明、现代化、价值投资与中国',
                author: '李录',
                progress: '-',
                bookId: '29196155',
            },
        ]);
    });
    it('rethrows AUTH_REQUIRED when the current session has no structured shelf cache', async () => {
        const command = getRegistry().get('weread/shelf');
        expect(command?.func).toBeTypeOf('function');
        const mockPage = {
            getCookies: vi.fn()
                // fetchPrivateApi: URL lookup (i.weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // fetchPrivateApi: domain lookup (weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // loadWebShelfSnapshot: domain lookup for wr_vid
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid-current', domain: '.weread.qq.com' }]),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                cacheFound: false,
                rawBooks: [],
                shelfIndexes: [],
                lastChapters: {},
            }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        await expect(command.func(mockPage, { limit: 20 })).rejects.toMatchObject({
            code: 'AUTH_REQUIRED',
            message: 'Not logged in to WeRead',
        });
        expect(mockPage.goto).toHaveBeenCalledWith('https://weread.qq.com/web/shelf');
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
    });
    it('returns an empty list when the current session cache is confirmed but empty', async () => {
        const command = getRegistry().get('weread/shelf');
        expect(command?.func).toBeTypeOf('function');
        const mockPage = {
            getCookies: vi.fn()
                // fetchPrivateApi: URL lookup (i.weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // fetchPrivateApi: domain lookup (weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // loadWebShelfSnapshot: domain lookup for wr_vid
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid-current', domain: '.weread.qq.com' }]),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                cacheFound: true,
                rawBooks: [],
                shelfIndexes: [],
                lastChapters: {},
            }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        const result = await command.func(mockPage, { limit: 20 });
        expect(mockPage.goto).toHaveBeenCalledWith('https://weread.qq.com/web/shelf');
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(result).toEqual([]);
    });
    it('falls back to raw book cache order when shelf indexes are unavailable', async () => {
        const command = getRegistry().get('weread/shelf');
        expect(command?.func).toBeTypeOf('function');
        const mockPage = {
            getCookies: vi.fn()
                // fetchPrivateApi: URL lookup (i.weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // fetchPrivateApi: domain lookup (weread.qq.com)
                .mockResolvedValueOnce([{ name: 'wr_skey', value: 'skey123', domain: '.weread.qq.com' }])
                // loadWebShelfSnapshot: domain lookup for wr_vid
                .mockResolvedValueOnce([{ name: 'wr_vid', value: 'vid-current', domain: '.weread.qq.com' }]),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                cacheFound: true,
                rawBooks: [
                    {
                        bookId: '40055543',
                        title: '置身事内：中国政府与经济发展',
                        author: '兰小欢',
                    },
                    {
                        bookId: '29196155',
                        title: '文明、现代化、价值投资与中国',
                        author: '李录',
                    },
                ],
                shelfIndexes: [],
            }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            json: () => Promise.resolve({ errcode: -2012, errmsg: '登录超时' }),
        }));
        const result = await command.func(mockPage, { limit: 2 });
        expect(mockPage.getCookies).toHaveBeenCalledWith({ url: 'https://i.weread.qq.com/shelf/sync?synckey=0&lectureSynckey=0' });
        expect(mockPage.getCookies).toHaveBeenCalledWith({ domain: 'weread.qq.com' });
        expect(result).toEqual([
            {
                title: '置身事内：中国政府与经济发展',
                author: '兰小欢',
                progress: '-',
                bookId: '40055543',
            },
            {
                title: '文明、现代化、价值投资与中国',
                author: '李录',
                progress: '-',
                bookId: '29196155',
            },
        ]);
    });
});
