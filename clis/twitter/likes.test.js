import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './likes.js';

function likesPayload() {
    return {
        data: {
            user: {
                result: {
                    timeline_v2: {
                        timeline: {
                            instructions: [{
                                entries: [{
                                    entryId: 'tweet-1',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '1',
                                                    legacy: {
                                                        full_text: 'liked post',
                                                        favorite_count: 7,
                                                        retweet_count: 2,
                                                        created_at: 'now',
                                                    },
                                                    core: {
                                                        user_results: {
                                                            result: {
                                                                legacy: { screen_name: 'alice', name: 'Alice' },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                }],
                            }],
                        },
                    },
                },
            },
        },
    };
}

describe('twitter likes helpers', () => {
    it('falls back when queryId contains unsafe characters', () => {
        expect(__test__.sanitizeQueryId('safe_Query-123', 'fallback')).toBe('safe_Query-123');
        expect(__test__.sanitizeQueryId('bad"id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId('bad/id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId(null, 'fallback')).toBe('fallback');
    });
    it('builds likes url with the provided queryId', () => {
        const url = __test__.buildLikesUrl('query123', '42', 20, 'cursor-1');
        expect(url).toContain('/i/api/graphql/query123/Likes');
        expect(decodeURIComponent(url)).toContain('"userId":"42"');
        expect(decodeURIComponent(url)).toContain('"cursor":"cursor-1"');
    });
    it('parses likes timeline entries and bottom cursor', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [
                                    {
                                        entries: [
                                            {
                                                entryId: 'tweet-1',
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                rest_id: '1',
                                                                legacy: {
                                                                    full_text: 'liked post',
                                                                    favorite_count: 7,
                                                                    retweet_count: 2,
                                                                    created_at: 'now',
                                                                },
                                                                core: {
                                                                    user_results: {
                                                                        result: {
                                                                            legacy: {
                                                                                screen_name: 'alice',
                                                                                name: 'Alice',
                                                                            },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                            {
                                                entryId: 'cursor-bottom-1',
                                                content: {
                                                    entryType: 'TimelineTimelineCursor',
                                                    cursorType: 'Bottom',
                                                    value: 'cursor-next',
                                                },
                                            },
                                        ],
                                    },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const result = __test__.parseLikes(payload, new Set());
        expect(result.nextCursor).toBe('cursor-next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            name: 'Alice',
            text: 'liked post',
            likes: 7,
            retweets: 2,
            created_at: 'now',
            url: 'https://x.com/alice/status/1',
        });
    });
});

describe('twitter likes command', () => {
    it('rejects invalid explicit username before cookies or navigation', async () => {
        const command = getRegistry().get('twitter/likes');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(command.func(page, { username: 'viewer/extra', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects route-like AppTabBar hrefs as AuthRequiredError', async () => {
        const command = getRegistry().get('twitter/likes');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                if (String(script).includes('AppTabBar_Profile_Link')) return '/home';
                throw new Error(`Unexpected evaluate: ${String(script).slice(0, 80)}`);
            }),
        };

        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('unwraps Browser Bridge envelopes for default-self user lookup and likes payload', async () => {
        const command = getRegistry().get('twitter/likes');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = String(script);
                if (text.includes('AppTabBar_Profile_Link')) {
                    return { session: 'site:twitter', data: '/viewer' };
                }
                if (text.includes('operationName')) return null;
                if (text.includes('/UserByScreenName')) {
                    return { session: 'site:twitter', data: '42' };
                }
                if (text.includes('/Likes')) {
                    return { session: 'site:twitter', data: likesPayload() };
                }
                throw new Error(`Unexpected evaluate: ${text.slice(0, 80)}`);
            }),
        };

        const rows = await command.func(page, { limit: 1 });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: '1', author: 'alice', text: 'liked post' });
        const likesCall = page.evaluate.mock.calls.find(([script]) => String(script).includes('/Likes')) || [];
        expect(decodeURIComponent(String(likesCall[0]))).toContain('"userId":"42"');
        expect(decodeURIComponent(String(likesCall[0]))).not.toContain('[object Object]');
    });
});
