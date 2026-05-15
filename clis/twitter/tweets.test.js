import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './tweets.js';

describe('twitter tweets helpers', () => {
    it('registers id and is_retweet in the default columns', () => {
        const cmd = getRegistry().get('twitter/tweets');
        expect(cmd?.columns).toEqual(['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls']);
    });

    it('makes the username argument optional so it can default to the logged-in user', () => {
        const cmd = getRegistry().get('twitter/tweets');
        const usernameArg = cmd?.args?.find((arg) => arg.name === 'username');
        expect(usernameArg).toBeDefined();
        expect(usernameArg?.required).not.toBe(true);
        expect(usernameArg?.help || '').toMatch(/default/i);
        expect(cmd?.description || '').toMatch(/default/i);
    });

    it('detects the logged-in user via AppTabBar_Profile_Link when no username is given', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const evaluatedScripts = [];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                evaluatedScripts.push(text);
                if (text.includes('AppTabBar_Profile_Link')) return '/viewer';
                if (text.includes('operationName')) return null; // operation metadata resolver
                if (text.includes('/UserByScreenName')) return '42';
                if (text.includes('/UserTweets')) {
                    return {
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
                                                                                full_text: 'own post',
                                                                                favorite_count: 0,
                                                                                retweet_count: 0,
                                                                                reply_count: 0,
                                                                                created_at: 'now',
                                                                            },
                                                                            core: {
                                                                                user_results: {
                                                                                    result: {
                                                                                        legacy: { screen_name: 'viewer', name: 'Viewer' },
                                                                                    },
                                                                                },
                                                                            },
                                                                        },
                                                                    },
                                                                },
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
                }
                return null;
            }),
        };
        const rows = await cmd.func(page, { limit: 1 });
        // Navigated home to read the logged-in user
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        // AppTabBar_Profile_Link probe happened before any GraphQL fetch
        const probeIdx = evaluatedScripts.findIndex((t) => t.includes('AppTabBar_Profile_Link'));
        const graphqlIdx = evaluatedScripts.findIndex((t) => t.includes('/UserByScreenName'));
        expect(probeIdx).toBeGreaterThanOrEqual(0);
        expect(graphqlIdx).toBeGreaterThan(probeIdx);
        // The detected handle ('viewer') was used for the UserByScreenName lookup
        const lookup = evaluatedScripts.find((t) => t.includes('/UserByScreenName')) || '';
        expect(decodeURIComponent(lookup)).toContain('"screen_name":"viewer"');
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: '1', author: 'viewer', url: 'https://x.com/viewer/status/1' });
    });

    it('throws AuthRequiredError when no username is given and the logged-in user cannot be detected', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => []),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('AppTabBar_Profile_Link')) return null;
                return null;
            }),
        };
        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rejects invalid explicit username before navigation', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { username: 'viewer/extra' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects non-profile AppTabBar hrefs instead of querying route names as users', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('AppTabBar_Profile_Link')) return '/home';
                throw new Error(`Unexpected evaluate: ${text.slice(0, 80)}`);
            }),
        };

        await expect(cmd.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });

    it('falls back when queryId contains unsafe characters', () => {
        expect(__test__.sanitizeQueryId('safe_Query-123', 'fallback')).toBe('safe_Query-123');
        expect(__test__.sanitizeQueryId('bad"id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId('bad/id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId(null, 'fallback')).toBe('fallback');
    });

    it('builds UserTweets url with cursor and features', () => {
        const url = __test__.buildUserTweetsUrl('query123', '42', 20, 'cursor-1');
        expect(url).toContain('/i/api/graphql/query123/UserTweets');
        const decoded = decodeURIComponent(url);
        expect(decoded).toContain('"userId":"42"');
        expect(decoded).toContain('"count":20');
        expect(decoded).toContain('"cursor":"cursor-1"');
        expect(decoded).toContain('longform_notetweets_consumption_enabled');
    });

    it('builds UserByScreenName url for the given handle', () => {
        const url = __test__.buildUserByScreenNameUrl('uquery', 'jakevin7');
        expect(url).toContain('/i/api/graphql/uquery/UserByScreenName');
        expect(decodeURIComponent(url)).toContain('"screen_name":"jakevin7"');
    });

    it('prefers note_tweet text over legacy.full_text for long posts', () => {
        const seen = new Set();
        const tweet = __test__.extractTweet({
            rest_id: '99',
            legacy: { full_text: 'short truncated…', favorite_count: 1, retweet_count: 0, reply_count: 0, created_at: 'now' },
            note_tweet: { note_tweet_results: { result: { text: 'full long-form body' } } },
            core: { user_results: { result: { legacy: { screen_name: 'bob', name: 'Bob' } } } },
            views: { count: '42' },
        }, seen);
        expect(tweet.text).toBe('full long-form body');
        expect(tweet.views).toBe(42);
    });

    it('flags retweets via RT prefix or retweeted_status_result', () => {
        const a = __test__.extractTweet({
            rest_id: '1',
            legacy: { full_text: 'RT @foo: hi', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: '' },
            core: { user_results: { result: { legacy: { screen_name: 'u', name: 'U' } } } },
        }, new Set());
        expect(a.is_retweet).toBe(true);

        const b = __test__.extractTweet({
            rest_id: '2',
            legacy: { full_text: 'hello', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: '', retweeted_status_result: { result: {} } },
            core: { user_results: { result: { legacy: { screen_name: 'u', name: 'U' } } } },
        }, new Set());
        expect(b.is_retweet).toBe(true);
    });

    it('unwraps TweetWithVisibilityResults', () => {
        const tweet = __test__.extractTweet({
            __typename: 'TweetWithVisibilityResults',
            tweet: {
                rest_id: '42',
                legacy: { full_text: 'visible post', favorite_count: 2, retweet_count: 0, reply_count: 0, created_at: 'now' },
                core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
            },
        }, new Set());
        expect(tweet).toMatchObject({ id: '42', author: 'alice', text: 'visible post' });
    });

    it('parses chronological tweets and skips pinned instruction', () => {
        const chronEntry = {
            entryId: 'tweet-1',
            content: {
                itemContent: {
                    tweet_results: {
                        result: {
                            rest_id: '1',
                            legacy: { full_text: 'chronological post', favorite_count: 5, retweet_count: 1, reply_count: 2, created_at: 'now' },
                            core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
                            views: { count: '100' },
                        },
                    },
                },
            },
        };
        const cursorEntry = {
            entryId: 'cursor-bottom-1',
            content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'cursor-next' },
        };
        const pinnedEntry = {
            entryId: 'tweet-pinned-999',
            content: {
                itemContent: {
                    tweet_results: {
                        result: {
                            rest_id: '999',
                            legacy: { full_text: 'pinned post', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: 'old' },
                            core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
                        },
                    },
                },
            },
        };
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [
                                    { type: 'TimelinePinEntry', entries: [pinnedEntry] },
                                    { entries: [chronEntry, cursorEntry] },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const result = __test__.parseUserTweets(payload, new Set());
        expect(result.nextCursor).toBe('cursor-next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            text: 'chronological post',
            likes: 5,
            views: 100,
            url: 'https://x.com/alice/status/1',
        });
    });

    it('recursively parses tweets nested in timeline modules', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [
                                    {
                                        type: 'TimelineAddEntries',
                                        entries: [
                                            {
                                                entryId: 'profile-conversation-1',
                                                content: {
                                                    entryType: 'TimelineTimelineModule',
                                                    items: [
                                                        {
                                                            item: {
                                                                itemContent: {
                                                                    tweet_results: {
                                                                        result: {
                                                                            rest_id: '2',
                                                                            legacy: { full_text: 'nested post', favorite_count: 1, retweet_count: 0, reply_count: 0, created_at: 'now' },
                                                                            core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
                                                                        },
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    ],
                                                },
                                            },
                                            {
                                                entryId: 'cursor-bottom-2',
                                                content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'next' },
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
        const result = __test__.parseUserTweets(payload, new Set());
        expect(result.nextCursor).toBe('next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({ id: '2', text: 'nested post' });
    });

    it('uses populated timeline instructions when timeline_v2 is present but empty', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: { timeline: { instructions: [] } },
                        timeline: {
                            timeline: {
                                instructions: [
                                    {
                                        type: 'TimelineAddEntries',
                                        entries: [
                                            {
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                rest_id: '3',
                                                                legacy: { full_text: 'fallback timeline post', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: 'now' },
                                                                core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
                                                            },
                                                        },
                                                    },
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
        const result = __test__.parseUserTweets(payload, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({ id: '3', text: 'fallback timeline post' });
    });
});
