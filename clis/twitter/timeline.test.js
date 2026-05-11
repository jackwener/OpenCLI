import { describe, expect, it } from 'vitest';
import { __test__ } from './timeline.js';
describe('twitter timeline helpers', () => {
    it('builds for-you variables with withCommunity', () => {
        expect(__test__.buildTimelineVariables('for-you', 20)).toEqual({
            count: 20,
            includePromotedContent: false,
            latestControlAvailable: true,
            requestContext: 'launch',
            withCommunity: true,
        });
    });
    it('builds following variables with seenTweetIds instead of withCommunity', () => {
        expect(__test__.buildTimelineVariables('following', 20, 'cursor-1')).toEqual({
            count: 20,
            includePromotedContent: false,
            latestControlAvailable: true,
            requestContext: 'launch',
            seenTweetIds: [],
            cursor: 'cursor-1',
        });
    });
    it('encodes variables into timeline url', () => {
        const url = __test__.buildHomeTimelineUrl('query123', 'HomeLatestTimeline', {
            count: 20,
            seenTweetIds: [],
        });
        expect(url).toContain('/i/api/graphql/query123/HomeLatestTimeline');
        expect(url).toContain('variables=');
        expect(url).toContain('features=');
        expect(decodeURIComponent(url)).toContain('"seenTweetIds":[]');
    });
    it('parses tweets and bottom cursor from home timeline payload', () => {
        const payload = {
            data: {
                home: {
                    home_timeline_urt: {
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
                                                            full_text: 'hello',
                                                            favorite_count: 3,
                                                            retweet_count: 2,
                                                            reply_count: 1,
                                                            created_at: 'now',
                                                        },
                                                        core: {
                                                            user_results: {
                                                                result: {
                                                                    legacy: {
                                                                        screen_name: 'alice',
                                                                    },
                                                                },
                                                            },
                                                        },
                                                        views: {
                                                            count: '9',
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
        };
        const result = __test__.parseHomeTimeline(payload, new Set());
        expect(result.nextCursor).toBe('cursor-next');
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            text: 'hello',
            likes: 3,
            retweets: 2,
            replies: 1,
            views: 9,
            created_at: 'now',
            url: 'https://x.com/alice/status/1',
        });
    });
});
