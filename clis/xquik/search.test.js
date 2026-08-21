import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    CommandExecutionError,
    ConfigError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { XQUIK_API_CONTRACT, normalizeSearchRow } from './utils.js';
import './search.js';

function jsonResponse(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

function tweet(overrides = {}) {
    return {
        id: '123',
        text: 'OpenCLI from Xquik',
        created: 1_725_801_600,
        like_count: 4,
        retweet_count: 3,
        reply_count: 2,
        quote_count: 1,
        bookmark_count: 5,
        view_count: 99,
        author: { username: 'alice', name: 'Alice', description: 'Builder' },
        media: [{ url: 'https://pbs.twimg.com/media/example.jpg' }],
        ...overrides,
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.XQUIK_API_KEY;
});

describe('xquik search adapter', () => {
    const command = getRegistry().get('xquik/search');

    it('declares a non-browser read command on the Xquik domain', () => {
        expect(command).toBeDefined();
        expect(command.access).toBe('read');
        expect(command.domain).toBe('xquik.com');
        expect(command.strategy).toBe(Strategy.PUBLIC);
        expect(command.browser).toBe(false);
        expect(command.columns).toContain('id');
        expect(command.columns).toContain('url');
    });

    it('searches with the normalized contract and maps stable post rows', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
            tweets: [tweet()],
            has_more: false,
            next_cursor: '',
        }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: 'OpenCLI agents', sort: 'Top', limit: 1, timeout: 12 })).resolves.toEqual([{
            rank: 1,
            id: '123',
            author: 'alice',
            name: 'Alice',
            bio: 'Builder',
            text: 'OpenCLI from Xquik',
            created_at: '2024-09-08T13:20:00.000Z',
            likes: 4,
            retweets: 3,
            replies: 2,
            quotes: 1,
            bookmarks: 5,
            views: 99,
            url: 'https://x.com/alice/status/123',
            media_urls: ['https://pbs.twimg.com/media/example.jpg'],
        }]);

        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://xquik.com/api/v1/x/tweets/search?q=OpenCLI+agents&queryType=Top&limit=1');
        expect(init.headers['x-api-key']).toBe('test-key');
        expect(init.headers['xquik-api-contract']).toBe(XQUIK_API_CONTRACT);
        expect(init.signal).toBeInstanceOf(AbortSignal);
    });

    it('accepts the legacy camel-case post fields defensively', () => {
        expect(normalizeSearchRow(tweet({
            created: undefined,
            createdAt: '2026-08-21T00:00:00Z',
            like_count: undefined,
            likeCount: 1,
            retweet_count: undefined,
            retweetCount: 2,
            reply_count: undefined,
            replyCount: 3,
            quote_count: undefined,
            quoteCount: 4,
            bookmark_count: undefined,
            bookmarkCount: 5,
            view_count: undefined,
            viewCount: 6,
            media: [{ previewUrl: 'https://pbs.twimg.com/preview.jpg' }],
            url: 'https://x.com/alice/status/123',
        }), 7)).toMatchObject({
            rank: 7,
            created_at: '2026-08-21T00:00:00Z',
            likes: 1,
            retweets: 2,
            replies: 3,
            quotes: 4,
            bookmarks: 5,
            views: 6,
            media_urls: ['https://pbs.twimg.com/preview.jpg'],
        });
    });

    it('requires an API key before sending a request', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: 'opencli' })).rejects.toBeInstanceOf(ConfigError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects invalid arguments before sending a request', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(command.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', timeout: 121 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func({ query: 'x', sort: 'Popular' })).rejects.toBeInstanceOf(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps an empty page to EmptyResultError', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tweets: [], has_more: false, next_cursor: '' })));

        await expect(command.func({ query: 'no match' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('surfaces authentication and credit failures with typed guidance', async () => {
        process.env.XQUIK_API_KEY = 'bad-key';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({
            error: { message: 'Authentication required.' },
        }, 401)).mockResolvedValueOnce(jsonResponse({
            error: { message: 'Credits required.' },
        }, 402)));

        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(ConfigError);
        await expect(command.func({ query: 'x' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            hint: expect.stringContaining('credits'),
        });
    });

    it('preserves Retry-After guidance for rate limits', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            error: { message: 'Slow down.', retry_after: 17 },
        }, 429, { 'retry-after': '17' })));

        await expect(command.func({ query: 'x' })).rejects.toMatchObject({
            name: 'CommandExecutionError',
            hint: 'Retry after 17 seconds.',
        });
    });

    it('typed-fails network timeouts and transport errors', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
        vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(abort).mockRejectedValueOnce(new Error('offline')));

        await expect(command.func({ query: 'x', timeout: 9 })).rejects.toBeInstanceOf(TimeoutError);
        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('typed-fails malformed JSON, payloads, rows, and metrics', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce(new Response('<html>', { status: 200 }))
            .mockResolvedValueOnce(jsonResponse({ data: [] }))
            .mockResolvedValueOnce(jsonResponse({ tweets: [null] }))
            .mockResolvedValueOnce(jsonResponse({ tweets: [tweet({ like_count: 'many' })] }))
            .mockResolvedValueOnce(jsonResponse({ tweets: [tweet({ created: Number.MAX_VALUE })] })));

        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func({ query: 'x' })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
