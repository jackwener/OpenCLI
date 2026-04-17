import { describe, expect, it } from 'vitest';
import { __test__ } from './likes.js';
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
