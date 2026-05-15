import { describe, expect, it } from 'vitest';
import { __test__ } from './bookmarks.js';

const { parseBookmarks, extractBookmarkTweet } = __test__;

describe('twitter bookmarks parser', () => {
    it('extracts a baseline tweet with no media (has_media false, media_urls empty)', () => {
        const tweet = extractBookmarkTweet({
            rest_id: '1',
            legacy: {
                full_text: 'plain bookmark',
                favorite_count: 5,
                retweet_count: 1,
                bookmark_count: 2,
                created_at: 'Wed Apr 16 10:00:00 +0000 2026',
            },
            core: { user_results: { result: { legacy: { screen_name: 'alice', name: 'Alice' } } } },
        }, new Set());
        expect(tweet).toEqual({
            id: '1',
            author: 'alice',
            name: 'Alice',
            text: 'plain bookmark',
            likes: 5,
            retweets: 1,
            bookmarks: 2,
            created_at: 'Wed Apr 16 10:00:00 +0000 2026',
            url: 'https://x.com/alice/status/1',
            has_media: false,
            media_urls: [],
        });
    });

    it('includes photo media URLs from extended_entities', () => {
        const tweet = extractBookmarkTweet({
            rest_id: '101',
            legacy: {
                full_text: 'pic bookmark',
                extended_entities: {
                    media: [
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/abc.jpg' },
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/def.jpg' },
                    ],
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'bob' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls).toEqual([
            'https://pbs.twimg.com/media/abc.jpg',
            'https://pbs.twimg.com/media/def.jpg',
        ]);
    });

    it('extracts mp4 variant URL for video media', () => {
        const tweet = extractBookmarkTweet({
            rest_id: '102',
            legacy: {
                full_text: 'video bookmark',
                extended_entities: {
                    media: [{
                        type: 'video',
                        media_url_https: 'https://pbs.twimg.com/amplify_video_thumb/thumb.jpg',
                        video_info: {
                            variants: [
                                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/playlist.m3u8' },
                                { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
                                { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' },
                            ],
                        },
                    }],
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'carol' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls?.[0]).toMatch(/\.mp4$/);
    });

    it('falls back to entities.media when extended_entities is absent', () => {
        const tweet = extractBookmarkTweet({
            rest_id: '103',
            legacy: {
                full_text: 'entities-only media',
                entities: {
                    media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/legacy.jpg' }],
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'dave' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls).toEqual(['https://pbs.twimg.com/media/legacy.jpg']);
    });

    it('prefers note_tweet text over truncated full_text', () => {
        const tweet = extractBookmarkTweet({
            rest_id: '2',
            legacy: { full_text: 'short text…', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
            note_tweet: { note_tweet_results: { result: { text: 'full long-form text body' } } },
            core: { user_results: { result: { core: { screen_name: 'erin' } } } },
        }, new Set());
        expect(tweet?.text).toBe('full long-form text body');
    });

    it('deduplicates tweets across the seen Set', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [{
                            entries: [
                                {
                                    entryId: 'tweet-3',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '3',
                                                    legacy: { full_text: 'first', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
                                                    core: { user_results: { result: { legacy: { screen_name: 'frank' } } } },
                                                },
                                            },
                                        },
                                    },
                                },
                                {
                                    entryId: 'tweet-3-dup',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '3',
                                                    legacy: { full_text: 'duplicate' },
                                                    core: { user_results: { result: { legacy: { screen_name: 'frank' } } } },
                                                },
                                            },
                                        },
                                    },
                                },
                            ],
                        }],
                    },
                },
            },
        };
        const seen = new Set();
        const { tweets } = parseBookmarks(data, seen);
        expect(tweets).toHaveLength(1);
        expect(tweets[0].text).toBe('first');
    });

    it('extracts cursor + tweets from the bookmark_timeline_v2 envelope', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [
                            {
                                type: 'TimelineAddEntries',
                                entries: [
                                    {
                                        entryId: 'tweet-4',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: '4',
                                                        legacy: {
                                                            full_text: 'envelope tweet',
                                                            favorite_count: 1,
                                                            retweet_count: 0,
                                                            bookmark_count: 0,
                                                            extended_entities: {
                                                                media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/x.jpg' }],
                                                            },
                                                        },
                                                        core: { user_results: { result: { legacy: { screen_name: 'gina' } } } },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    {
                                        entryId: 'cursor-bottom-Y',
                                        content: { __typename: 'TimelineTimelineCursor', cursorType: 'Bottom', value: 'NEXT' },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const { tweets, nextCursor } = parseBookmarks(data, new Set());
        expect(tweets).toHaveLength(1);
        expect(tweets[0].id).toBe('4');
        expect(tweets[0].has_media).toBe(true);
        expect(tweets[0].media_urls).toEqual(['https://pbs.twimg.com/media/x.jpg']);
        expect(nextCursor).toBe('NEXT');
    });

    it('returns empty tweets + null cursor for unknown envelope', () => {
        expect(parseBookmarks({}, new Set())).toEqual({ tweets: [], nextCursor: null });
    });
});
