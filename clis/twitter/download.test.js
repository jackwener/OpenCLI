import { beforeEach, describe, expect, it, vi } from 'vitest';
const { mockDownloadMedia, mockFormatCookieHeader } = vi.hoisted(() => ({
    mockDownloadMedia: vi.fn(),
    mockFormatCookieHeader: vi.fn(() => 'ct0=token'),
}));
vi.mock('@jackwener/opencli/download/media-download', () => ({
    downloadMedia: mockDownloadMedia,
}));
vi.mock('@jackwener/opencli/download', () => ({
    formatCookieHeader: mockFormatCookieHeader,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './download.js';

const {
    buildUserMediaUrl,
    buildUserByScreenNameUrl,
    parseUserMedia,
    classifyMediaUrl,
    requireLimit,
    nextUserMediaFetchCount,
} = __test__;

function createPageMock(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const result of evaluateResults) evaluate.mockResolvedValueOnce(result);
    evaluate.mockResolvedValue(undefined);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'token', domain: '.x.com' }]),
    };
}

function userLookupPayload(userId = '42') {
    return {
        ok: true,
        payload: {
            data: {
                user: {
                    result: { rest_id: userId },
                },
            },
        },
    };
}

function userMediaPayload(entries) {
    return {
        ok: true,
        payload: {
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
        },
    };
}

function tweetEntry(id, url = `https://pbs.twimg.com/media/${id}.jpg`) {
    return {
        content: {
            itemContent: {
                tweet_results: {
                    result: {
                        rest_id: id,
                        legacy: {
                            extended_entities: {
                                media: [{ type: 'photo', media_url_https: url }],
                            },
                        },
                    },
                },
            },
        },
    };
}

describe('twitter download helpers', () => {
    beforeEach(() => {
        mockDownloadMedia.mockReset();
        mockDownloadMedia.mockResolvedValue([{ index: 1, type: 'image', status: 'success', size: '1 KB' }]);
        mockFormatCookieHeader.mockClear();
    });

    it('registers the canonical download columns', () => {
        const cmd = getRegistry().get('twitter/download');
        expect(cmd?.columns).toEqual(['index', 'tweet_id', 'url', 'type', 'status', 'size']);
    });

    it('makes username positional and tweet-url a flag', () => {
        const cmd = getRegistry().get('twitter/download');
        const usernameArg = cmd?.args?.find((a) => a.name === 'username');
        const tweetUrlArg = cmd?.args?.find((a) => a.name === 'tweet-url');
        expect(usernameArg?.positional).toBe(true);
        expect(tweetUrlArg?.positional).not.toBe(true);
    });

    it('builds a UserMedia URL with userId, count and cursor', () => {
        const url = buildUserMediaUrl(
            { queryId: 'QID', features: { fa: true }, fieldToggles: { fb: true } },
            '42',
            50,
            'cursor-xyz',
        );
        expect(url.startsWith('/i/api/graphql/QID/UserMedia?')).toBe(true);
        const vars = JSON.parse(decodeURIComponent(url.match(/variables=([^&]+)/)[1]));
        expect(vars.userId).toBe('42');
        expect(vars.count).toBe(50);
        expect(vars.cursor).toBe('cursor-xyz');
        expect(vars.includePromotedContent).toBe(false);
    });

    it('omits cursor variable when not paging', () => {
        const url = buildUserMediaUrl({ queryId: 'QID', features: {}, fieldToggles: {} }, '42', 10, null);
        const vars = JSON.parse(decodeURIComponent(url.match(/variables=([^&]+)/)[1]));
        expect(vars.cursor).toBeUndefined();
    });

    it('builds a UserByScreenName URL with the screen_name variable', () => {
        const url = buildUserByScreenNameUrl(
            { queryId: 'UBSN', features: {}, fieldToggles: {} },
            'jack',
        );
        expect(url.startsWith('/i/api/graphql/UBSN/UserByScreenName?')).toBe(true);
        expect(decodeURIComponent(url)).toContain('"screen_name":"jack"');
    });

    it('classifies twimg video URLs as video and pbs URLs as image', () => {
        expect(classifyMediaUrl('https://video.twimg.com/amplify_video/123/vid/avc1/720x1280/abc.mp4?tag=27')).toBe('video');
        expect(classifyMediaUrl('https://pbs.twimg.com/media/AbCdEf.jpg')).toBe('image');
        expect(classifyMediaUrl('https://example.com/clip.m3u8')).toBe('video');
        expect(classifyMediaUrl(null)).toBe('unknown');
    });

    it('strictly validates profile download limit', () => {
        expect(requireLimit(undefined)).toBe(10);
        expect(requireLimit(1)).toBe(1);
        for (const value of [0, -1, 1.5, 'abc', 1001]) {
            expect(() => requireLimit(value)).toThrow(ArgumentError);
        }
    });

    it('calculates profile media page sizes without silently clamping user input', () => {
        expect(nextUserMediaFetchCount(1, 0)).toBe(11);
        expect(nextUserMediaFetchCount(1000, 0)).toBe(100);
        expect(nextUserMediaFetchCount(1000, 950)).toBe(60);
        expect(nextUserMediaFetchCount(10, 10)).toBe(0);
    });

    it('extracts media urls and the bottom cursor from a UserMedia payload', () => {
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
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                rest_id: 'tweet-1',
                                                                legacy: {
                                                                    extended_entities: {
                                                                        media: [
                                                                            { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/IMG1.jpg' },
                                                                            { type: 'video', video_info: { variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/v/1.mp4' }] } },
                                                                        ],
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            },
                                            {
                                                content: {
                                                    entryType: 'TimelineTimelineCursor',
                                                    cursorType: 'Bottom',
                                                    value: 'next-cursor-abc',
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
        const seen = new Set();
        const { items, nextCursor } = parseUserMedia(payload, seen);
        expect(nextCursor).toBe('next-cursor-abc');
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ tweet_id: 'tweet-1', url: 'https://pbs.twimg.com/media/IMG1.jpg', type: 'image' });
        expect(items[1]).toMatchObject({ tweet_id: 'tweet-1', url: 'https://video.twimg.com/v/1.mp4', type: 'video' });
        expect(seen.has('tweet-1')).toBe(true);
    });

    it('skips already-seen tweets across pages', () => {
        const tweetEntry = (id) => ({
            content: {
                itemContent: {
                    tweet_results: {
                        result: {
                            rest_id: id,
                            legacy: {
                                extended_entities: {
                                    media: [{ type: 'photo', media_url_https: `https://pbs.twimg.com/media/${id}.jpg` }],
                                },
                            },
                        },
                    },
                },
            },
        });
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [{ entries: [tweetEntry('A'), tweetEntry('A'), tweetEntry('B')] }],
                            },
                        },
                    },
                },
            },
        };
        const seen = new Set();
        const { items } = parseUserMedia(payload, seen);
        expect(items.map((item) => item.tweet_id)).toEqual(['A', 'B']);
    });

    it('treats TweetWithVisibilityResults wrappers as tweets', () => {
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
                                                content: {
                                                    itemContent: {
                                                        tweet_results: {
                                                            result: {
                                                                __typename: 'TweetWithVisibilityResults',
                                                                tweet: {
                                                                    rest_id: 'wrapped-1',
                                                                    legacy: {
                                                                        extended_entities: {
                                                                            media: [{ type: 'photo', media_url_https: 'https://pbs.twimg.com/media/W.jpg' }],
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
        const { items } = parseUserMedia(payload, new Set());
        expect(items).toHaveLength(1);
        expect(items[0].tweet_id).toBe('wrapped-1');
    });

    it('fails typed when UserMedia payload has no timeline instructions', () => {
        expect(() => parseUserMedia({ data: { user: { result: {} } } }, new Set()))
            .toThrow(CommandExecutionError);
    });

    it('rejects missing, mixed, invalid username and invalid limit before navigation', async () => {
        const cmd = getRegistry().get('twitter/download');
        for (const args of [
            {},
            { username: 'jack', 'tweet-url': 'https://x.com/jack/status/123' },
            { username: 'bad/name' },
            { username: 'jack', limit: 0 },
        ]) {
            const page = createPageMock();
            await expect(cmd.func(page, args)).rejects.toBeInstanceOf(ArgumentError);
            expect(page.goto).not.toHaveBeenCalled();
        }
    });

    it('downloads profile media through UserByScreenName and UserMedia GraphQL payloads', async () => {
        const cmd = getRegistry().get('twitter/download');
        mockDownloadMedia.mockResolvedValueOnce([
            { index: 1, type: 'image', status: 'success', size: '1 KB' },
            { index: 2, type: 'image', status: 'success', size: '2 KB' },
        ]);
        const page = createPageMock([
            { queryId: 'UM', features: { a: true }, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            userLookupPayload('42'),
            userMediaPayload([
                tweetEntry('A'),
                {
                    content: {
                        entryType: 'TimelineTimelineCursor',
                        cursorType: 'Bottom',
                        value: 'cursor-1',
                    },
                },
            ]),
            userMediaPayload([tweetEntry('B')]),
        ]);
        const rows = await cmd.func(page, { username: '@jack', limit: 2, output: './out' });
        expect(page.goto).toHaveBeenCalledWith('https://x.com/jack');
        expect(page.evaluate).toHaveBeenCalledTimes(5);
        expect(mockDownloadMedia).toHaveBeenCalledWith([
            { tweet_id: 'A', url: 'https://pbs.twimg.com/media/A.jpg', type: 'image' },
            { tweet_id: 'B', url: 'https://pbs.twimg.com/media/B.jpg', type: 'image' },
        ], expect.objectContaining({
            output: './out',
            subdir: 'jack',
            filenamePrefix: 'jack',
            cookies: 'ct0=token',
        }));
        expect(rows).toEqual([
            {
                index: 1,
                tweet_id: 'A',
                url: 'https://pbs.twimg.com/media/A.jpg',
                type: 'image',
                status: 'success',
                size: '1 KB',
            },
            {
                index: 2,
                tweet_id: 'B',
                url: 'https://pbs.twimg.com/media/B.jpg',
                type: 'image',
                status: 'success',
                size: '2 KB',
            },
        ]);
    });

    it('maps missing ct0 and GraphQL auth failures to AuthRequiredError', async () => {
        const cmd = getRegistry().get('twitter/download');
        const noCt0Page = createPageMock();
        noCt0Page.getCookies.mockResolvedValueOnce([]);
        await expect(cmd.func(noCt0Page, { username: 'jack', limit: 1 }))
            .rejects.toBeInstanceOf(AuthRequiredError);

        const authPage = createPageMock([
            { queryId: 'UM', features: {}, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            { ok: false, status: 401 },
        ]);
        await expect(cmd.func(authPage, { username: 'jack', limit: 1 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails typed for malformed UserMedia and fetch failures instead of partial success', async () => {
        const cmd = getRegistry().get('twitter/download');
        const malformedPage = createPageMock([
            { queryId: 'UM', features: {}, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            userLookupPayload('42'),
            { ok: true, payload: { data: { user: { result: {} } } } },
        ]);
        await expect(cmd.func(malformedPage, { username: 'jack', limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        const partialPage = createPageMock([
            { queryId: 'UM', features: {}, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            userLookupPayload('42'),
            userMediaPayload([
                tweetEntry('A'),
                {
                    content: {
                        entryType: 'TimelineTimelineCursor',
                        cursorType: 'Bottom',
                        value: 'cursor-1',
                    },
                },
            ]),
            { ok: false, status: 500 },
        ]);
        await expect(cmd.func(partialPage, { username: 'jack', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        expect(mockDownloadMedia).not.toHaveBeenCalled();

        const repeatedCursorPage = createPageMock([
            { queryId: 'UM', features: {}, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            userLookupPayload('42'),
            userMediaPayload([
                tweetEntry('A'),
                {
                    content: {
                        entryType: 'TimelineTimelineCursor',
                        cursorType: 'Bottom',
                        value: 'cursor-1',
                    },
                },
            ]),
            userMediaPayload([
                tweetEntry('B'),
                {
                    content: {
                        entryType: 'TimelineTimelineCursor',
                        cursorType: 'Bottom',
                        value: 'cursor-1',
                    },
                },
            ]),
        ]);
        await expect(cmd.func(repeatedCursorPage, { username: 'jack', limit: 3 }))
            .rejects.toThrowError(/same cursor twice/);
        expect(mockDownloadMedia).not.toHaveBeenCalled();
    });

    it('uses typed empty result for profile or tweet media absence', async () => {
        const cmd = getRegistry().get('twitter/download');
        const profilePage = createPageMock([
            { queryId: 'UM', features: {}, fieldToggles: {} },
            { queryId: 'UB', features: {}, fieldToggles: {} },
            userLookupPayload('42'),
            userMediaPayload([]),
        ]);
        await expect(cmd.func(profilePage, { username: 'jack', limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);

        const tweetPage = createPageMock([[]]);
        await expect(cmd.func(tweetPage, { 'tweet-url': 'https://x.com/jack/status/123' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
