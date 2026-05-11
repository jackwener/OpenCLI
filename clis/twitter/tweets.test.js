import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './tweets.js';

describe('twitter tweets helpers', () => {
    it('registers id and is_retweet in the default columns', () => {
        const cmd = getRegistry().get('twitter/tweets');
        expect(cmd?.columns).toEqual(['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls']);
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
});
