import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './thread.js';

describe('twitter thread parser', () => {
    it('extracts author bio from tweet user entity', () => {
        const command = getRegistry().get('twitter/thread');
        expect(command?.columns).toEqual(['id', 'author', 'bio', 'text', 'likes', 'retweets', 'url', 'has_media', 'media_urls', 'card', 'quoted_tweet']);
        const result = __test__.parseTweetDetail({
            data: {
                threaded_conversation_with_injections_v2: {
                    instructions: [
                        {
                            entries: [
                                {
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '1',
                                                    legacy: {
                                                        full_text: 'thread tweet',
                                                        favorite_count: 3,
                                                        retweet_count: 2,
                                                    },
                                                    core: {
                                                        user_results: {
                                                            result: {
                                                                legacy: {
                                                                    screen_name: 'alice',
                                                                    description: 'Thread author bio',
                                                                },
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
        }, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            bio: 'Thread author bio',
            text: 'thread tweet',
            likes: 3,
            retweets: 2,
            url: 'https://x.com/alice/status/1',
        });
    });
});
