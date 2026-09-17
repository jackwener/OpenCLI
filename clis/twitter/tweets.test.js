import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { __test__ } from './tweets.js';
import { buildUserTweetsUrl } from './user-timeline.js';

function makeTweetEntry(id, author = 'jakevin7') {
    return {
        entryId: `tweet-${id}`,
        content: {
            itemContent: {
                tweet_results: {
                    result: {
                        rest_id: String(id),
                        legacy: {
                            full_text: `post ${id}`,
                            favorite_count: 0,
                            retweet_count: 0,
                            reply_count: 0,
                            created_at: 'now',
                        },
                        core: {
                            user_results: {
                                result: {
                                    legacy: { screen_name: author, name: author },
                                },
                            },
                        },
                    },
                },
            },
        },
    };
}

function makeTimelinePayload(startId, count, nextCursor = null) {
    const entries = Array.from({ length: count }, (_, index) => makeTweetEntry(startId + index));
    if (nextCursor) {
        entries.push({
            entryId: `cursor-bottom-${nextCursor}`,
            content: { entryType: 'TimelineTimelineCursor', cursorType: 'Bottom', value: nextCursor },
        });
    }
    return {
        data: {
            user: {
                result: {
                    timeline_v2: {
                        timeline: {
                            instructions: [{ entries }],
                        },
                    },
                },
            },
        },
    };
}

describe('twitter tweets helpers', () => {
    it('keeps tweets command arguments and columns unchanged after transport extraction', () => {
        const cmd = getRegistry().get('twitter/tweets');
        expect(cmd?.args?.map((arg) => arg.name)).toEqual([
            'username', 'limit', 'page-delay', 'top-by-engagement', 'expand-urls', 'cursor', 'cursor-file',
        ]);
        expect(cmd?.columns).toEqual([
            'id', 'author', 'created_at', 'is_retweet', 'text', 'likes',
            'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls',
            'media_posters', 'quoted_tweet', 'retweeted_tweet',
        ]);
        expect(buildUserTweetsUrl('query', '42', 20, 'cursor')).toContain('/UserTweets');
    });

    it('registers id and is_retweet in the default columns', () => {
        const cmd = getRegistry().get('twitter/tweets');
        expect(cmd?.columns).toEqual(['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls', 'media_posters', 'quoted_tweet', 'retweeted_tweet']);
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

    it('fetches limits above 200 across cursor pages with a delay between pages', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const userTweetsRequests = [];
        const pages = [
            makeTimelinePayload(1, 100, 'cursor-1'),
            makeTimelinePayload(101, 100, 'cursor-2'),
            makeTimelinePayload(201, 60, null),
        ];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('operationName')) return null;
                if (text.includes('/UserByScreenName')) return '42';
                if (text.includes('/UserTweets')) {
                    userTweetsRequests.push(decodeURIComponent(text));
                    return pages[userTweetsRequests.length - 1];
                }
                return null;
            }),
        };

        const rows = await cmd.func(page, { username: 'jakevin7', limit: 250 });

        expect(rows).toHaveLength(250);
        expect(rows[0]).toMatchObject({ id: '1', text: 'post 1' });
        expect(rows[249]).toMatchObject({ id: '250', text: 'post 250' });
        expect(userTweetsRequests).toHaveLength(3);
        expect(userTweetsRequests[0]).toContain('"count":100');
        expect(userTweetsRequests[0]).not.toContain('"cursor"');
        expect(userTweetsRequests[1]).toContain('"cursor":"cursor-1"');
        expect(userTweetsRequests[1]).toContain('"count":100');
        expect(userTweetsRequests[2]).toContain('"cursor":"cursor-2"');
        expect(userTweetsRequests[2]).toContain('"count":60');
        expect(page.wait).toHaveBeenCalledTimes(2);
        expect(page.wait).toHaveBeenNthCalledWith(1, 2);
        expect(page.wait).toHaveBeenNthCalledWith(2, 2);
    });

    it('rejects invalid tweet limits before navigation', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { username: 'jakevin7', limit: __test__.MAX_TWEETS_LIMIT + 1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { username: 'jakevin7', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects invalid pagination delays before navigation', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(cmd.func(page, { username: 'jakevin7', limit: 20, 'page-delay': -1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { username: 'jakevin7', limit: 20, 'page-delay': 61 })).rejects.toBeInstanceOf(ArgumentError);
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

    it('expands t.co links in text, quoted text and note_tweet entity sets when --expand-urls is set', () => {
        const node = {
            rest_id: '7',
            legacy: {
                full_text: 'see https://t.co/abc and https://t.co/keep',
                favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: 'now',
                entities: { urls: [{ url: 'https://t.co/abc', expanded_url: 'https://example.com/a' }] },
                is_quote_status: true,
            },
            note_tweet: { note_tweet_results: { result: {
                text: 'long https://t.co/abc plus https://t.co/def',
                entity_set: { urls: [{ url: 'https://t.co/def', expanded_url: 'https://example.com/d' }] },
            } } },
            quoted_status_result: { result: {
                rest_id: '8',
                legacy: { full_text: 'quoted https://t.co/q', created_at: 'then', entities: { urls: [{ url: 'https://t.co/q', expanded_url: 'https://example.com/q' }] } },
                core: { user_results: { result: { legacy: { screen_name: 'quoter', name: 'Q' } } } },
            } },
            core: { user_results: { result: { legacy: { screen_name: 'bob', name: 'Bob' } } } },
        };
        const plain = __test__.extractTweet(node, new Set());
        expect(plain.text).toBe('long https://t.co/abc plus https://t.co/def');
        expect(plain.quoted_tweet.text).toBe('quoted https://t.co/q');

        const expanded = __test__.extractTweet(node, new Set(), { expandUrls: true });
        expect(expanded.text).toBe('long https://example.com/a plus https://example.com/d');
        expect(expanded.quoted_tweet.text).toBe('quoted https://example.com/q');
    });

    it('surfaces the original post behind a repost as retweeted_tweet', () => {
        const tweet = __test__.extractTweet({
            rest_id: '1',
            legacy: {
                full_text: 'RT @alice: truncated https://t.co/x…',
                favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: 'now',
                retweeted_status_result: { result: {
                    __typename: 'TweetWithVisibilityResults',
                    tweet: {
                        rest_id: '900',
                        legacy: {
                            full_text: 'the whole original text https://t.co/x https://t.co/pic',
                            favorite_count: 12, retweet_count: 3, reply_count: 1, created_at: 'earlier',
                            entities: { urls: [{ url: 'https://t.co/x', expanded_url: 'https://example.com/x' }] },
                            extended_entities: { media: [{ type: 'photo', url: 'https://t.co/pic', expanded_url: 'https://x.com/alice/status/900/photo/1', media_url_https: 'https://pbs.twimg.com/p.jpg' }] },
                        },
                        views: { count: '456' },
                        core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
                    },
                } },
            },
            core: { user_results: { result: { legacy: { screen_name: 'reposter', name: 'R' } } } },
        }, new Set(), { expandUrls: true });
        expect(tweet.is_retweet).toBe(true);
        expect(tweet.author).toBe('reposter');
        expect(tweet.has_media).toBe(false);
        expect(tweet.retweeted_tweet).toMatchObject({
            id: '900',
            author: 'alice',
            name: 'Alice',
            text: 'the whole original text https://example.com/x https://x.com/alice/status/900/photo/1',
            likes: 12,
            views: 456,
            url: 'https://x.com/alice/status/900',
            has_media: true,
            media_urls: ['https://pbs.twimg.com/p.jpg'],
        });
    });

    it('returns retweeted_tweet null for own posts and for tombstoned originals', () => {
        const own = __test__.extractTweet({
            rest_id: '1',
            legacy: { full_text: 'mine', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: '' },
            core: { user_results: { result: { legacy: { screen_name: 'u', name: 'U' } } } },
        }, new Set());
        expect(own.retweeted_tweet).toBeNull();

        const tombstone = __test__.extractTweet({
            rest_id: '2',
            legacy: { full_text: 'RT @gone: …', favorite_count: 0, retweet_count: 0, reply_count: 0, created_at: '', retweeted_status_result: { result: { __typename: 'TweetTombstone' } } },
            core: { user_results: { result: { legacy: { screen_name: 'u', name: 'U' } } } },
        }, new Set());
        expect(tombstone.is_retweet).toBe(true);
        expect(tombstone.retweeted_tweet).toBeNull();
    });

    it('resumes from --cursor and writes the next cursor to --cursor-file (empty when exhausted)', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-tweets-cursor-'));
        const cursorFile = path.join(dir, 'nested', 'cursor.txt');
        const userTweetsRequests = [];
        const pages = [
            makeTimelinePayload(101, 100, 'cursor-2'),
            makeTimelinePayload(201, 100, 'cursor-3'),
        ];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('operationName')) return null;
                if (text.includes('/UserByScreenName')) return '42';
                if (text.includes('/UserTweets')) {
                    userTweetsRequests.push(decodeURIComponent(text));
                    return pages[userTweetsRequests.length - 1];
                }
                return null;
            }),
        };

        // Stops on --limit: whole pages are returned and the boundary cursor is saved.
        const rows = await cmd.func(page, { username: 'jakevin7', limit: 150, cursor: 'cursor-1', 'cursor-file': cursorFile, 'page-delay': 0 });
        expect(userTweetsRequests[0]).toContain('"cursor":"cursor-1"');
        expect(userTweetsRequests).toHaveLength(2);
        expect(rows).toHaveLength(200);
        expect(fs.readFileSync(cursorFile, 'utf8').trim()).toBe('cursor-3');

        // Exhausted timeline: the file is emptied so callers can tell "done" from "paused".
        userTweetsRequests.length = 0;
        pages.splice(0, pages.length, makeTimelinePayload(301, 5, null));
        const tail = await cmd.func(page, { username: 'jakevin7', limit: 100, cursor: 'cursor-3', 'cursor-file': cursorFile, 'page-delay': 0 });
        expect(tail).toHaveLength(5);
        expect(fs.readFileSync(cursorFile, 'utf8')).toBe('');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('keeps the resume point in --cursor-file when the first resumed page is rate-limited', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-tweets-cursor-'));
        const cursorFile = path.join(dir, 'cursor.txt');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('operationName')) return null;
                if (text.includes('/UserByScreenName')) return '42';
                if (text.includes('/UserTweets')) return { error: 429 };
                return null;
            }),
        };
        await expect(cmd.func(page, { username: 'jakevin7', limit: 100, cursor: 'cursor-9', 'cursor-file': cursorFile })).rejects.toThrow(/HTTP 429/);
        expect(fs.readFileSync(cursorFile, 'utf8').trim()).toBe('cursor-9');
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('returns an empty array instead of EmptyResultError when a resumed run finds no tail', async () => {
        const cmd = getRegistry().get('twitter/tweets');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'token' }]),
            evaluate: vi.fn(async (script) => {
                const text = typeof script === 'function' ? script.toString() : String(script);
                if (text.includes('operationName')) return null;
                if (text.includes('/UserByScreenName')) return '42';
                if (text.includes('/UserTweets')) return makeTimelinePayload(1, 0, null);
                return null;
            }),
        };
        await expect(cmd.func(page, { username: 'jakevin7', limit: 20, cursor: 'cursor-end' })).resolves.toEqual([]);
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
