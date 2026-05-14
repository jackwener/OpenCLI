import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ConfigError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './tweet.js';
import './trends.js';
import './user-search.js';
import './user-tweets.js';
import './user.js';

const originalFetch = global.fetch;
const originalKey = process.env.XQUIK_API_KEY;

afterEach(() => {
    global.fetch = originalFetch;
    if (originalKey == null) delete process.env.XQUIK_API_KEY;
    else process.env.XQUIK_API_KEY = originalKey;
    vi.restoreAllMocks();
});

function command(name) {
    return getRegistry().get(`xquik/${name}`);
}

function mockJson(payload, status = 200) {
    global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(payload), { status })));
}

describe('xquik adapters', () => {
    it('requires XQUIK_API_KEY before requests', async () => {
        delete process.env.XQUIK_API_KEY;
        await expect(command('search').func({ query: 'opencli' })).rejects.toBeInstanceOf(ConfigError);
    });

    it('search maps paginated tweets and sends the API key header', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({
            tweets: [
                {
                    id: '123',
                    text: 'OpenCLI adapter',
                    createdAt: '2026-05-14T12:00:00Z',
                    likeCount: 7,
                    replyCount: 1,
                    retweetCount: 2,
                    viewCount: 90,
                    author: { username: 'xquikcom' },
                },
            ],
            has_next_page: true,
            next_cursor: 'cursor-1',
        });

        const rows = await command('search').func({ query: 'opencli', limit: 1, queryType: 'Top' });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: '123',
            author: 'xquikcom',
            text: 'OpenCLI adapter',
            likes: 7,
            nextCursor: 'cursor-1',
        });
        expect(global.fetch.mock.calls[0][1].headers['x-api-key']).toBe('test-key');
        expect(String(global.fetch.mock.calls[0][0])).toContain('/api/v1/x/tweets/search');
        expect(String(global.fetch.mock.calls[0][0])).toContain('queryType=Top');
    });

    it('tweet lookup combines tweet and author payloads', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({
            tweet: { id: '456', text: 'single post', likeCount: 3 },
            author: { username: 'alice' },
        });

        const rows = await command('tweet').func({ id: '456' });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: '456', author: 'alice', text: 'single post', likes: 3 });
    });

    it('user lookup normalizes profile URLs', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({ id: 'u1', username: 'alice', name: 'Alice', followers: 42, verified: true });

        const rows = await command('user').func({ id: '@alice' });

        expect(rows[0]).toMatchObject({
            id: 'u1',
            username: 'alice',
            name: 'Alice',
            followers: 42,
            verified: true,
            profileUrl: 'https://x.com/alice',
        });
        expect(String(global.fetch.mock.calls[0][0])).toContain('/api/v1/x/users/alice');
    });

    it('user-search promotes empty result arrays', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({ users: [], has_next_page: false, next_cursor: '' });

        await expect(command('user-search').func({ query: 'nobody' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('user-tweets forwards reply flags', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({
            tweets: [{ id: '789', text: 'reply included', author: { username: 'alice' } }],
            has_next_page: false,
            next_cursor: '',
        });

        const rows = await command('user-tweets').func({ id: 'alice', includeReplies: true, includeParentTweet: true });

        expect(rows[0]).toMatchObject({ id: '789', author: 'alice' });
        const url = String(global.fetch.mock.calls[0][0]);
        expect(url).toContain('includeReplies=true');
        expect(url).toContain('includeParentTweet=true');
    });

    it('trends maps topic rows', async () => {
        process.env.XQUIK_API_KEY = 'test-key';
        mockJson({
            woeid: 1,
            trends: [{ name: '#AI', description: 'Artificial intelligence', query: '%23AI', rank: 1 }],
        });

        const rows = await command('trends').func({ count: 1 });

        expect(rows).toEqual([
            { rank: 1, name: '#AI', description: 'Artificial intelligence', query: '%23AI', woeid: 1 },
        ]);
    });
});
