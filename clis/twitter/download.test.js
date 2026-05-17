import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './download.js';

const { buildUserMediaUrl, buildUserByScreenNameUrl, parseUserMedia, classifyMediaUrl } = __test__;

describe('twitter download helpers', () => {
    it('registers the canonical download columns', () => {
        const cmd = getRegistry().get('twitter/download');
        expect(cmd?.columns).toEqual(['index', 'type', 'status', 'size']);
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
});
