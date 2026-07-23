import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import './tweets.js';
import { __test__ } from './collection.js';

function syntheticTweet(id, {
    author = 'synth_author',
    createdAt = '2026-07-23T12:00:00.000Z',
    legacy = {},
    quotedStatusResult,
    retweetedStatusResult,
} = {}) {
    return {
        rest_id: String(id),
        legacy: {
            full_text: `synthetic post ${id}`,
            favorite_count: 0,
            retweet_count: 0,
            reply_count: 0,
            created_at: createdAt,
            ...legacy,
        },
        core: {
            user_results: {
                result: {
                    rest_id: `user-${author}`,
                    legacy: { screen_name: author, name: author },
                },
            },
        },
        ...(quotedStatusResult ? { quoted_status_result: quotedStatusResult } : {}),
        ...(retweetedStatusResult ? { retweeted_status_result: retweetedStatusResult } : {}),
    };
}

function tweetEntry(tweet) {
    return { content: { itemContent: { tweet_results: { result: tweet } } } };
}

function collectionPayload(tweets, nextCursor = null) {
    const entries = tweets.map(tweetEntry);
    if (nextCursor) {
        entries.push({
            content: {
                entryType: 'TimelineTimelineCursor',
                cursorType: 'Bottom',
                value: nextCursor,
            },
        });
    }
    return {
        data: {
            user: {
                result: {
                    timeline_v2: { timeline: { instructions: [{ entries }] } },
                },
            },
        },
    };
}

describe('twitter collection', () => {
    it('registers an independent read command with posts and receipt columns', () => {
        const command = getRegistry().get('twitter/collection');
        expect(command).toMatchObject({
            access: 'read',
            browser: true,
            columns: ['posts', 'receipt'],
        });
        expect(command?.args?.map((arg) => arg.name)).toEqual([
            'username', 'until', 'limit', 'page-delay',
        ]);
        expect(getRegistry().get('twitter/tweets')?.args?.map((arg) => arg.name))
            .not.toContain('collection-receipt');
    });

    it('classifies original, quote, reply and repost without inventing context', () => {
        expect(__test__.extractRelationship(syntheticTweet('10'))).toEqual({
            kind: 'original',
            target: null,
        });
        expect(__test__.extractRelationship(syntheticTweet('11', {
            legacy: {
                in_reply_to_status_id_str: '30',
                in_reply_to_screen_name: 'parent_author',
                in_reply_to_user_id_str: 'user-parent_author',
            },
        }))).toMatchObject({
            kind: 'reply',
            target: { post_id: '30', context_status: 'unavailable' },
        });
        expect(__test__.extractRelationship(syntheticTweet('12', {
            legacy: { is_quote_status: true, quoted_status_id_str: '50' },
            quotedStatusResult: { result: { __typename: 'TweetTombstone' } },
        }))).toMatchObject({
            kind: 'quote',
            target: { post_id: '50', context_status: 'unavailable' },
        });
        expect(__test__.extractRelationship(syntheticTweet('13', {
            legacy: { retweeted_status_id_str: '60' },
            retweetedStatusResult: { result: syntheticTweet('60', { author: 'repost_target' }) },
        }))).toMatchObject({
            kind: 'repost',
            target: {
                post_id: '60',
                author_handle: 'repost_target',
                context_status: 'complete',
            },
        });
    });

    it('rejects an unresolved repost instead of inferring it from text', () => {
        expect(() => __test__.extractRelationship(syntheticTweet('14', {
            legacy: { full_text: 'RT @someone: synthetic', retweeted_status_id_str: '70' },
        }))).toThrow(CommandExecutionError);
        expect(() => __test__.extractRelationship(syntheticTweet('14', {
            legacy: { full_text: 'RT @someone: synthetic', retweeted_status_id_str: '70' },
        }))).toThrow(/twitter_collection_unresolved_relationship/);
    });

    it('accepts only RFC3339 lower boundaries', () => {
        expect(__test__.normalizeUntil('2026-07-23T00:00:00Z')).toBeInstanceOf(Date);
        expect(() => __test__.normalizeUntil('2026-07-23')).toThrow(ArgumentError);
        expect(() => __test__.normalizeUntil('not-a-date')).toThrow(ArgumentError);
    });

    it('completes only after the lower boundary is reached', async () => {
        const result = await __test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 10,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('20', { createdAt: '2026-07-23T01:00:00.000Z' }),
                syntheticTweet('21', { createdAt: '2026-07-22T23:59:59.000Z' }),
            ], 'unused-cursor'),
        });
        expect(result).toMatchObject({
            posts: [
                { id: '20' },
                { id: '21' },
            ],
            receipt: {
                completed: true,
                stop_reason: 'time_boundary_reached',
                requested_until: '2026-07-23T00:00:00.000Z',
                pages_fetched: 1,
                oldest_seen_at: '2026-07-22T23:59:59.000Z',
            },
        });
    });

    it('completes on cursor exhaustion and exposes no cursor', async () => {
        const result = await __test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 10,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('22', { createdAt: '2026-07-23T01:00:00.000Z' }),
            ]),
        });
        expect(result).toMatchObject({
            receipt: { completed: true, stop_reason: 'cursor_exhausted', pages_fetched: 1 },
        });
        expect(Object.keys(result.receipt)).not.toContain('cursor');
    });

    it('returns the posts and receipt envelope from the registered command', async () => {
        const command = getRegistry().get('twitter/collection');
        const page = {
            getCookies: vi.fn(async () => [{ name: 'ct0', value: 'test-only' }]),
            wait: vi.fn(async () => undefined),
            evaluate: vi.fn(async (script) => {
                const source = String(script);
                if (source.includes('operationName')) return null;
                if (source.includes('/UserByScreenName')) return '42';
                if (source.includes('/UserTweets')) {
                    return collectionPayload([
                        syntheticTweet('27', { createdAt: '2026-07-22T23:59:59.000Z' }),
                    ]);
                }
                return null;
            }),
        };
        const result = await command.func(page, {
            username: 'synth_author',
            until: '2026-07-23T00:00:00Z',
            limit: 10,
            'page-delay': 0,
        });
        expect(result).toMatchObject({
            posts: [{ id: '27', relationship: { kind: 'original' } }],
            receipt: { completed: true, stop_reason: 'time_boundary_reached' },
        });
    });

    it('fails on repeated cursor, limit, page guard, and malformed timestamps', async () => {
        await expect(__test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 10,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('23', { createdAt: '2026-07-23T01:00:00.000Z' }),
            ], 'same-cursor'),
        })).rejects.toThrow(/twitter_collection_repeated_cursor/);
        await expect(__test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 1,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('24', { createdAt: '2026-07-23T01:00:00.000Z' }),
            ], 'next-cursor'),
        })).rejects.toThrow(/twitter_collection_limit_reached/);
        await expect(__test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 1,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('24a', { createdAt: '2026-07-23T01:00:00.000Z' }),
                syntheticTweet('24b', { createdAt: '2026-07-22T23:59:59.000Z' }),
            ]),
        })).rejects.toThrow(/twitter_collection_limit_reached/);
        await expect(__test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 10,
            maxPages: 1,
            fetchPage: async () => collectionPayload([
                syntheticTweet('25', { createdAt: '2026-07-23T01:00:00.000Z' }),
            ], 'next-cursor'),
        })).rejects.toThrow(/twitter_collection_page_guard_hit/);
        await expect(__test__.paginateCollection({
            until: __test__.normalizeUntil('2026-07-23T00:00:00Z'),
            limit: 10,
            maxPages: 5,
            fetchPage: async () => collectionPayload([
                syntheticTweet('26', { createdAt: 'not-a-timestamp' }),
            ]),
        })).rejects.toThrow(/twitter_collection_invalid_timestamp/);
    });
});
