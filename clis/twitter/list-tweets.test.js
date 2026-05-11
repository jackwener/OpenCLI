import { describe, expect, it } from 'vitest';
import { extractTimelineTweet, parseListTimeline } from './list-tweets.js';

describe('twitter list-tweets parser', () => {
    it('extracts core tweet fields from a ListLatestTweetsTimeline result', () => {
        const tweet = extractTimelineTweet({
            rest_id: '99',
            legacy: {
                full_text: 'hello list',
                favorite_count: 3,
                retweet_count: 1,
                reply_count: 2,
                created_at: 'Wed Apr 16 10:00:00 +0000 2026',
            },
            core: {
                user_results: {
                    result: {
                        legacy: { screen_name: 'bob', name: 'Bob' },
                    },
                },
            },
        }, new Set());
        expect(tweet).toEqual({
            id: '99',
            author: 'bob',
            name: 'Bob',
            text: 'hello list',
            likes: 3,
            retweets: 1,
            replies: 2,
            created_at: 'Wed Apr 16 10:00:00 +0000 2026',
            url: 'https://x.com/bob/status/99',
            has_media: false,
            media_urls: [],
        });
    });

    it('includes photo media URLs from extended_entities', () => {
        const tweet = extractTimelineTweet({
            rest_id: '101',
            legacy: {
                full_text: 'pic post',
                extended_entities: {
                    media: [
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/abc.jpg' },
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/def.jpg' },
                    ],
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'dave' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls).toEqual([
            'https://pbs.twimg.com/media/abc.jpg',
            'https://pbs.twimg.com/media/def.jpg',
        ]);
    });

    it('extracts mp4 variant URL for video media', () => {
        const tweet = extractTimelineTweet({
            rest_id: '102',
            legacy: {
                full_text: 'video post',
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
            core: { user_results: { result: { legacy: { screen_name: 'erin' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls?.[0]).toMatch(/\.mp4$/);
    });

    it('prefers long-form note_tweet text over truncated legacy full_text', () => {
        const tweet = extractTimelineTweet({
            rest_id: '100',
            legacy: { full_text: 'short…' },
            note_tweet: {
                note_tweet_results: {
                    result: { text: 'the full long-form body' },
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'carol' } } } },
        }, new Set());
        expect(tweet?.text).toBe('the full long-form body');
    });

    it('deduplicates on rest_id', () => {
        const seen = new Set();
        const first = extractTimelineTweet({ rest_id: '1', legacy: {}, core: {} }, seen);
        const second = extractTimelineTweet({ rest_id: '1', legacy: {}, core: {} }, seen);
        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });

    it('parses entries and bottom cursor from the list timeline payload', () => {
        const payload = {
            data: {
                list: {
                    tweets_timeline: {
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
                                                            legacy: { full_text: 't1' },
                                                            core: { user_results: { result: { legacy: { screen_name: 'a' } } } },
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
        };
        const result = parseListTimeline(payload, new Set());
        expect(result.nextCursor).toBe('cursor-next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({ id: '1', author: 'a', text: 't1' });
    });

    it('returns empty tweets and null cursor for malformed payload', () => {
        const result = parseListTimeline({}, new Set());
        expect(result.tweets).toEqual([]);
        expect(result.nextCursor).toBeNull();
    });
});
