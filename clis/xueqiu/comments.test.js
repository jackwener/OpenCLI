import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockWarn } = vi.hoisted(() => ({
    mockWarn: vi.fn(),
}));
vi.mock('@jackwener/opencli/logger', () => ({
    log: {
        info: vi.fn(),
        warn: mockWarn,
        error: vi.fn(),
        verbose: vi.fn(),
        debug: vi.fn(),
        step: vi.fn(),
        stepResult: vi.fn(),
    },
}));
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { classifyXueqiuCommentsResponse, collectCommentRows, mergeUniqueCommentRows, normalizeCommentItem, normalizeSymbolInput, } from './comments.js';
const command = getRegistry().get('xueqiu/comments');
function createCommandPage(response) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(response),
    };
}
describe('xueqiu comments', () => {
    beforeEach(() => {
        mockWarn.mockReset();
    });
    it('rejects blank symbol before any request is made', () => {
        expect(() => normalizeSymbolInput('   ')).toThrow(ArgumentError);
    });
    it('rejects URL-like input before any request is made', () => {
        expect(() => normalizeSymbolInput('https://xueqiu.com/S/SH600519')).toThrow(ArgumentError);
    });
    it('normalizes symbol by trimming and upper-casing it', () => {
        expect(normalizeSymbolInput('  sh600519  ')).toBe('SH600519');
    });
    it('accepts supported US and HK-style symbols', () => {
        expect(normalizeSymbolInput('aapl')).toBe('AAPL');
        expect(normalizeSymbolInput('00700')).toBe('00700');
    });
    it('rejects obviously invalid symbols before any request is made', () => {
        expect(() => normalizeSymbolInput('INVALID')).toThrow(ArgumentError);
    });
    it('classifies 401 responses as auth failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 401,
            contentType: 'application/json',
            json: null,
            textSnippet: '',
        })).toMatchObject({ kind: 'auth' });
    });
    it('classifies html challenge pages as anti-bot failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'text/html',
            json: null,
            textSnippet: '<textarea id="renderData">{"_waf_bd8ce2ce37":"token"}</textarea>',
        })).toMatchObject({ kind: 'anti-bot' });
    });
    it('classifies 403 html challenge pages as anti-bot failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 403,
            contentType: 'text/html',
            json: null,
            textSnippet: '<textarea id="renderData">{"_waf_bd8ce2ce37":"token"}</textarea>',
        })).toMatchObject({ kind: 'anti-bot' });
    });
    it('classifies 403 html challenge pages without waf markers as anti-bot failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 403,
            contentType: 'text/html',
            json: null,
            textSnippet: '<html><body>security challenge required</body></html>',
        })).toMatchObject({ kind: 'anti-bot' });
    });
    it('does not misclassify generic html error pages as anti-bot failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 500,
            contentType: 'text/html',
            json: null,
            textSnippet: '<html><body>server error</body></html>',
        })).toMatchObject({ kind: 'unknown' });
    });
    it('classifies html login pages as auth failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'text/html',
            json: null,
            textSnippet: '<html><body>login required</body></html>',
        })).toMatchObject({ kind: 'auth' });
    });
    it('classifies invalid-symbol json envelopes as argument failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'application/json',
            json: { success: false, error: 'invalid symbol format' },
            textSnippet: '',
        })).toMatchObject({ kind: 'argument' });
    });
    it('does not misclassify required-field backend errors as auth failures', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'application/json',
            json: { success: false, message: 'symbol is required' },
            textSnippet: '',
        })).toMatchObject({ kind: 'incompatible' });
    });
    it('classifies json responses without a usable list as incompatible', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'application/json',
            json: { success: true, data: { next_max_id: 1 } },
            textSnippet: '',
        })).toMatchObject({ kind: 'incompatible' });
    });
    it('classifies empty discussion lists as empty results', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'application/json',
            json: { list: [] },
            textSnippet: '',
        })).toMatchObject({ kind: 'empty' });
    });
    it('classifies unclear json error envelopes as incompatible', () => {
        expect(classifyXueqiuCommentsResponse({
            status: 200,
            contentType: 'application/json',
            json: { success: false, message: 'unexpected backend state' },
            textSnippet: '',
        })).toMatchObject({ kind: 'incompatible' });
    });
    it('deduplicates rows by stable id while preserving order', () => {
        expect(mergeUniqueCommentRows([], [
            { id: 'a', author: 'alice' },
            { id: 'b', author: 'bob' },
            { id: 'a', author: 'alice-duplicate' },
        ])).toEqual([
            { id: 'a', author: 'alice' },
            { id: 'b', author: 'bob' },
        ]);
    });
    it('normalizes one raw discussion item into a cleaned row', () => {
        expect(normalizeCommentItem({
            id: 123,
            description: '<p>hello&nbsp;<b>world</b></p>',
            created_at: 1700000000000,
            user: { screen_name: 'alice', id: 99 },
            reply_count: 2,
            retweet_count: 3,
            fav_count: 4,
        })).toEqual({
            id: '123',
            author: 'alice',
            text: 'hello world',
            likes: 4,
            replies: 2,
            retweets: 3,
            created_at: new Date(1700000000000).toISOString(),
            url: 'https://xueqiu.com/99/123',
        });
    });
    it('drops invalid created_at values instead of throwing', () => {
        expect(normalizeCommentItem({
            id: 456,
            description: 'hello',
            created_at: 'not-a-date',
            user: { screen_name: 'bob', id: 100 },
        })).toEqual({
            id: '456',
            author: 'bob',
            text: 'hello',
            likes: 0,
            replies: 0,
            retweets: 0,
            created_at: null,
            url: 'https://xueqiu.com/100/456',
        });
    });
    it('drops object-like ids instead of turning them into fake identifiers', () => {
        expect(normalizeCommentItem({
            id: { broken: true },
            description: 'hello',
            created_at: 1700000000000,
            user: { screen_name: 'eve', id: { broken: true } },
        })).toEqual({
            id: '',
            author: 'eve',
            text: 'hello',
            likes: 0,
            replies: 0,
            retweets: 0,
            created_at: new Date(1700000000000).toISOString(),
            url: null,
        });
    });
    it('normalizes invalid count fields to zero', () => {
        expect(normalizeCommentItem({
            id: 789,
            description: 'hello',
            created_at: 1700000000000,
            user: { screen_name: 'carol', id: 101 },
            reply_count: 'oops',
            retweet_count: Infinity,
            fav_count: '',
        })).toEqual({
            id: '789',
            author: 'carol',
            text: 'hello',
            likes: 0,
            replies: 0,
            retweets: 0,
            created_at: new Date(1700000000000).toISOString(),
            url: 'https://xueqiu.com/101/789',
        });
    });
    it('registers the xueqiu comments command', () => {
        expect(command).toMatchObject({
            site: 'xueqiu',
            name: 'comments',
        });
    });
    it('rejects blank symbol before navigating the page', async () => {
        const page = {
            goto: vi.fn(),
        };
        await expect(command.func(page, { symbol: '   ', limit: 5 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws auth error when the first page responds with 401', async () => {
        const page = createCommandPage({
            status: 401,
            contentType: 'application/json',
            json: null,
            textSnippet: '',
        });
        await expect(command.func(page, { symbol: 'sh600519', limit: 5 })).rejects.toThrow(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://xueqiu.com');
    });
    it('rejects invalid symbols before navigating the page', async () => {
        const page = {
            goto: vi.fn(),
        };
        await expect(command.func(page, { symbol: 'INVALID', limit: 5 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects non-positive limit before navigating the page', async () => {
        const page = {
            goto: vi.fn(),
        };
        await expect(command.func(page, { symbol: 'SH600519', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(command.func(page, { symbol: 'SH600519', limit: -1 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('rejects limits above the supported maximum before navigating the page', async () => {
        const page = {
            goto: vi.fn(),
        };
        await expect(command.func(page, { symbol: 'SH600519', limit: 101 })).rejects.toThrow(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws empty-result error with normalized symbol when the first page is empty', async () => {
        const page = createCommandPage({
            status: 200,
            contentType: 'application/json',
            json: { list: [] },
            textSnippet: '',
        });
        const rejection = command.func(page, { symbol: 'sh600519', limit: 5 });
        await expect(rejection).rejects.toThrow(EmptyResultError);
        await expect(rejection).rejects.toThrow('SH600519');
    });
    it('throws argument error when the first page reports an invalid symbol', async () => {
        const page = createCommandPage({
            status: 200,
            contentType: 'application/json',
            json: { success: false, error: 'invalid symbol format' },
            textSnippet: '',
        });
        const rejection = command.func(page, { symbol: 'sh600519', limit: 5 });
        await expect(rejection).rejects.toThrow(ArgumentError);
        await expect(rejection).rejects.toThrow('SH600519');
    });
    it('throws a compact incompatible-response error when json shape is unusable', async () => {
        const page = createCommandPage({
            status: 200,
            contentType: 'application/json',
            json: { success: true, data: { next_max_id: 1 } },
            textSnippet: '',
        });
        const rejection = command.func(page, { symbol: 'sh600519', limit: 5 });
        await expect(rejection).rejects.toThrow(CommandExecutionError);
        await expect(rejection).rejects.toThrow('Unexpected response');
    });
    it('throws auth-required error when the first page is an html challenge', async () => {
        const page = createCommandPage({
            status: 200,
            contentType: 'text/html',
            json: null,
            textSnippet: '<textarea id="renderData">{"_waf_bd8ce2ce37":"token"}</textarea>',
        });
        await expect(command.func(page, { symbol: 'sh600519', limit: 5 })).rejects.toThrow(AuthRequiredError);
    });
    it('throws command-execution error when the first page fetch fails before any rows are available', async () => {
        const page = createCommandPage({
            status: 0,
            contentType: 'text/plain',
            json: null,
            textSnippet: 'network failed',
        });
        const rejection = command.func(page, { symbol: 'sh600519', limit: 5 });
        await expect(rejection).rejects.toThrow(CommandExecutionError);
        await expect(rejection).rejects.toThrow('Unexpected response');
    });
    it('returns normalized rows when the first page includes discussion items', async () => {
        const page = createCommandPage({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    {
                        id: 123,
                        description: '<p>hello&nbsp;<b>world</b></p>',
                        created_at: 1700000000000,
                        user: { screen_name: 'alice', id: 99 },
                        reply_count: 2,
                        retweet_count: 3,
                        fav_count: 4,
                    },
                ],
            },
            textSnippet: '',
        });
        const result = await command.func(page, { symbol: 'sh600519', limit: 5 });
        expect(result).toEqual([
            {
                author: 'alice',
                text: 'hello world',
                likes: 4,
                replies: 2,
                retweets: 3,
                created_at: new Date(1700000000000).toISOString(),
                url: 'https://xueqiu.com/99/123',
            },
        ]);
        expect(Object.keys(result[0]).sort()).toEqual([
            'author',
            'created_at',
            'likes',
            'replies',
            'retweets',
            'text',
            'url',
        ]);
    });
    it('collects later pages, deduplicates rows, and trims to limit', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 2, description: 'beta-duplicate', user: { screen_name: 'bob', id: 11 } },
                    { id: 3, description: 'gamma', user: { screen_name: 'carol', id: 12 } },
                ],
            },
            textSnippet: '',
        });
        await expect(collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        })).resolves.toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
            { id: '3', text: 'gamma' },
        ]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).not.toHaveBeenCalled();
    });
    it('returns partial rows and emits warning when a later page fails', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'text/html',
            json: null,
            textSnippet: '<textarea id="renderData">{"_waf_bd8ce2ce37":"token"}</textarea>',
        });
        await expect(collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        })).resolves.toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('2/3'));
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('anti-bot'));
    });
    it('returns partial rows and emits warning when a later page has an unknown fetch failure', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 0,
            contentType: 'text/plain',
            json: null,
            textSnippet: 'network failed',
        });
        await expect(collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        })).resolves.toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('2/3'));
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('unknown request failure'));
    });
    it('ends pagination quietly when a later page returns an empty list', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: { list: [] },
            textSnippet: '',
        });
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).not.toHaveBeenCalled();
    });
    it('returns partial rows and emits warning when a later page does not advance pagination', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha-duplicate', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta-duplicate', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        });
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('2/3'));
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('pagination did not advance'));
    });
    it('drops rows without ids and warns when pagination cannot advance', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { description: 'missing-id-a', user: { screen_name: 'carol', id: 12 } },
                    { description: 'missing-id-b', user: { screen_name: 'dave', id: 13 } },
                ],
            },
            textSnippet: '',
        });
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(result).toHaveLength(2);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('2/3'));
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('unknown request failure'));
    });
    it('continues pagination when a full page contains both valid rows and missing-id rows', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { description: 'missing-id', user: { screen_name: 'carol', id: 12 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                    { id: 3, description: 'gamma', user: { screen_name: 'dave', id: 13 } },
                ],
            },
            textSnippet: '',
        });
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 3,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
            { id: '3', text: 'gamma' },
        ]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).not.toHaveBeenCalled();
    });
    it('does not warn when a short final page contains only duplicate rows', async () => {
        const fetchPage = vi
            .fn()
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 1, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: 2, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        })
            .mockResolvedValueOnce({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: 2, description: 'beta-duplicate', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        });
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 5,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toMatchObject([
            { id: '1', text: 'alpha' },
            { id: '2', text: 'beta' },
        ]);
        expect(fetchPage).toHaveBeenCalledTimes(2);
        expect(mockWarn).not.toHaveBeenCalled();
    });
    it('emits warning when pagination stops at the safety cap', async () => {
        let nextId = 1;
        const fetchPage = vi
            .fn()
            .mockImplementation(async () => ({
            status: 200,
            contentType: 'application/json',
            json: {
                list: [
                    { id: nextId++, description: 'alpha', user: { screen_name: 'alice', id: 10 } },
                    { id: nextId++, description: 'beta', user: { screen_name: 'bob', id: 11 } },
                ],
            },
            textSnippet: '',
        }));
        const result = await collectCommentRows({
            symbol: 'SH600519',
            limit: 12,
            pageSize: 2,
            maxRequests: 5,
            fetchPage,
            warn: mockWarn,
        });
        expect(result).toHaveLength(10);
        expect(fetchPage).toHaveBeenCalledTimes(5);
        expect(mockWarn).toHaveBeenCalledTimes(1);
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('10/12'));
        expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('reached safety cap'));
    });
});
