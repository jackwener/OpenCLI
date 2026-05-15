import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './bookmark-folder.js';

const { parseBookmarkFolderTimeline, extractFolderTweet, buildFolderTimelineUrl, FOLDER_ID_PATTERN } = __test__;

describe('twitter bookmark-folder URL builder', () => {
    it('embeds the folder id and count in the variables payload', () => {
        const url = buildFolderTimelineUrl('queryX', '12345', 50, null);
        const m = url.match(/variables=([^&]+)/);
        const vars = JSON.parse(decodeURIComponent(m[1]));
        expect(vars.bookmark_collection_id).toBe('12345');
        expect(vars.count).toBe(50);
        expect(vars.includePromotedContent).toBe(false);
        expect(vars.cursor).toBeUndefined();
    });

    it('appends the cursor when one is supplied', () => {
        const url = buildFolderTimelineUrl('queryX', '12345', 50, 'CURSOR_VAL');
        const m = url.match(/variables=([^&]+)/);
        const vars = JSON.parse(decodeURIComponent(m[1]));
        expect(vars.cursor).toBe('CURSOR_VAL');
    });

    it('coerces a numeric folder id to a string', () => {
        const url = buildFolderTimelineUrl('queryX', 555, 10);
        const m = url.match(/variables=([^&]+)/);
        const vars = JSON.parse(decodeURIComponent(m[1]));
        expect(vars.bookmark_collection_id).toBe('555');
    });

    it('preserves opaque folder ids without truncating them', () => {
        const url = buildFolderTimelineUrl('queryX', 'folder_AbC-123', 10);
        const m = url.match(/variables=([^&]+)/);
        const vars = JSON.parse(decodeURIComponent(m[1]));
        expect(vars.bookmark_collection_id).toBe('folder_AbC-123');
    });
});

describe('twitter bookmark-folder timeline parser', () => {
    it('extracts tweets from bookmark_timeline_v2 envelope', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [
                            {
                                type: 'TimelineAddEntries',
                                entries: [
                                    {
                                        entryId: 'tweet-1',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: '1',
                                                        legacy: {
                                                            full_text: 'first folder tweet',
                                                            favorite_count: 9,
                                                            retweet_count: 2,
                                                            bookmark_count: 3,
                                                            created_at: 'Tue Mar 17 09:00:00 +0000 2026',
                                                        },
                                                        core: {
                                                            user_results: {
                                                                result: { core: { screen_name: 'alice' } },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                    },
                                    {
                                        entryId: 'cursor-bottom-X',
                                        content: {
                                            __typename: 'TimelineTimelineCursor',
                                            cursorType: 'Bottom',
                                            value: 'NEXT_CURSOR',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
        };
        const { tweets, nextCursor } = parseBookmarkFolderTimeline(data, new Set());
        expect(tweets).toEqual([
            {
                id: '1',
                author: 'alice',
                text: 'first folder tweet',
                likes: 9,
                retweets: 2,
                bookmarks: 3,
                created_at: 'Tue Mar 17 09:00:00 +0000 2026',
                url: 'https://x.com/alice/status/1',
                has_media: false,
                media_urls: [],
            },
        ]);
        expect(nextCursor).toBe('NEXT_CURSOR');
    });

    it('falls back to bookmark_collection_timeline envelope', () => {
        const data = {
            data: {
                bookmark_collection_timeline: {
                    timeline: {
                        instructions: [
                            {
                                entries: [
                                    {
                                        entryId: 'tweet-2',
                                        content: {
                                            itemContent: {
                                                tweet_results: {
                                                    result: {
                                                        rest_id: '2',
                                                        legacy: { full_text: 'collection envelope', favorite_count: 1, retweet_count: 0, bookmark_count: 0 },
                                                        core: { user_results: { result: { legacy: { screen_name: 'bob' } } } },
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
        };
        const { tweets } = parseBookmarkFolderTimeline(data, new Set());
        expect(tweets).toHaveLength(1);
        expect(tweets[0].id).toBe('2');
        expect(tweets[0].author).toBe('bob');
    });

    it('uses note_tweet text when present (long-form tweets)', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [{
                            entries: [{
                                entryId: 'tweet-3',
                                content: {
                                    itemContent: {
                                        tweet_results: {
                                            result: {
                                                rest_id: '3',
                                                legacy: { full_text: 'short text', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
                                                note_tweet: { note_tweet_results: { result: { text: 'full long-form text' } } },
                                                core: { user_results: { result: { core: { screen_name: 'carol' } } } },
                                            },
                                        },
                                    },
                                },
                            }],
                        }],
                    },
                },
            },
        };
        const { tweets } = parseBookmarkFolderTimeline(data, new Set());
        expect(tweets[0].text).toBe('full long-form text');
    });

    it('deduplicates tweets across the seen Set', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [{
                            entries: [
                                {
                                    entryId: 'tweet-4',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '4',
                                                    legacy: { full_text: 'first', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
                                                    core: { user_results: { result: { core: { screen_name: 'dan' } } } },
                                                },
                                            },
                                        },
                                    },
                                },
                                {
                                    entryId: 'tweet-4-dup',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '4',
                                                    legacy: { full_text: 'duplicate' },
                                                    core: { user_results: { result: { core: { screen_name: 'dan' } } } },
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
        const { tweets } = parseBookmarkFolderTimeline(data, seen);
        expect(tweets).toHaveLength(1);
        expect(tweets[0].text).toBe('first');
    });

    it('does not synthesize an unknown author sentinel when screen_name is missing', () => {
        const data = {
            data: {
                bookmark_timeline_v2: {
                    timeline: {
                        instructions: [{
                            entries: [{
                                entryId: 'tweet-5',
                                content: {
                                    itemContent: {
                                        tweet_results: {
                                            result: {
                                                rest_id: '5',
                                                legacy: { full_text: 'missing author', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
                                                core: { user_results: { result: {} } },
                                            },
                                        },
                                    },
                                },
                            }],
                        }],
                    },
                },
            },
        };
        const { tweets } = parseBookmarkFolderTimeline(data, new Set());
        expect(tweets[0].author).toBe('');
        expect(tweets[0].url).toBe('https://x.com/i/status/5');
    });

    it('returns empty array + null cursor for unknown envelope', () => {
        expect(parseBookmarkFolderTimeline({}, new Set())).toEqual({ tweets: [], nextCursor: null });
    });

    it('includes photo media URLs from extended_entities', () => {
        const tweet = extractFolderTweet({
            rest_id: '101',
            legacy: {
                full_text: 'pic folder tweet',
                extended_entities: {
                    media: [
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/abc.jpg' },
                        { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/def.jpg' },
                    ],
                },
            },
            core: { user_results: { result: { legacy: { screen_name: 'eve' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls).toEqual([
            'https://pbs.twimg.com/media/abc.jpg',
            'https://pbs.twimg.com/media/def.jpg',
        ]);
    });

    it('extracts mp4 variant URL for video media', () => {
        const tweet = extractFolderTweet({
            rest_id: '102',
            legacy: {
                full_text: 'video folder tweet',
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
            core: { user_results: { result: { legacy: { screen_name: 'frank' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(true);
        expect(tweet?.media_urls?.[0]).toMatch(/\.mp4$/);
    });

    it('returns has_media false / media_urls empty when no media present', () => {
        const tweet = extractFolderTweet({
            rest_id: '103',
            legacy: { full_text: 'text only', favorite_count: 0, retweet_count: 0, bookmark_count: 0 },
            core: { user_results: { result: { legacy: { screen_name: 'gail' } } } },
        }, new Set());
        expect(tweet?.has_media).toBe(false);
        expect(tweet?.media_urls).toEqual([]);
    });
});

describe('twitter bookmark-folder id validation', () => {
    it('accepts numeric and opaque safe ids from bookmark-folders output', () => {
        expect(FOLDER_ID_PATTERN.test('1234567890')).toBe(true);
        expect(FOLDER_ID_PATTERN.test('folder_AbC-123')).toBe(true);
    });

    it('rejects ids that could pollute GraphQL variables or URL construction', () => {
        for (const value of ['folder/123', 'folder?x=1', 'folder%2F123', 'folder.123', 'folder 123', '']) {
            expect(FOLDER_ID_PATTERN.test(value)).toBe(false);
        }
    });
});

describe('twitter bookmark-folder command (registry)', () => {
    it('throws ArgumentError on unsafe folder-id before navigation', async () => {
        const command = getRegistry().get('twitter/bookmark-folder');
        expect(command?.func).toBeTypeOf('function');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };
        await expect(command.func(page, { 'folder-id': 'folder/123', limit: 5 }))
            .rejects
            .toThrow(/Invalid folder-id/);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws ArgumentError on empty folder-id', async () => {
        const command = getRegistry().get('twitter/bookmark-folder');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn(),
        };
        await expect(command.func(page, { 'folder-id': '   ', limit: 5 }))
            .rejects
            .toThrow(/Invalid folder-id/);
    });

    it('throws ArgumentError on invalid limit before navigation', async () => {
        const command = getRegistry().get('twitter/bookmark-folder');
        for (const limit of [0, -1, 1.5, Number.NaN]) {
            const page = {
                goto: vi.fn(),
                wait: vi.fn(),
                evaluate: vi.fn(),
            };
            await expect(command.func(page, { 'folder-id': '12345', limit }))
                .rejects
                .toThrow(/Invalid --limit/);
            expect(page.goto).not.toHaveBeenCalled();
        }
    });

    it('throws AuthRequiredError when ct0 cookie is missing', async () => {
        const command = getRegistry().get('twitter/bookmark-folder');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([]),
            evaluate: vi.fn().mockResolvedValue(null),
        };
        await expect(command.func(page, { 'folder-id': '12345', limit: 5 }))
            .rejects
            .toThrow(/Not logged into x.com/);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
    });

    it('accepts an opaque safe folder-id and sends it in the GraphQL variables', async () => {
        const command = getRegistry().get('twitter/bookmark-folder');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'ct0-token' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce('queryX')
                .mockResolvedValueOnce({ data: { bookmark_timeline_v2: { timeline: { instructions: [] } } } }),
        };
        const result = await command.func(page, { 'folder-id': 'folder_AbC-123', limit: 5 });
        expect(result).toEqual([]);
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://x.com' });
        const fetchScript = page.evaluate.mock.calls[1][0];
        expect(decodeURIComponent(fetchScript)).toContain('"bookmark_collection_id":"folder_AbC-123"');
    });
});
