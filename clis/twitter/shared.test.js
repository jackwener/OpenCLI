import { describe, expect, it } from 'vitest';
import { __test__ } from './shared.js';

const { extractMedia } = __test__;

describe('twitter extractMedia', () => {
    it('returns false + empty list when legacy has no media', () => {
        expect(extractMedia({})).toEqual({ has_media: false, media_urls: [] });
        expect(extractMedia(undefined)).toEqual({ has_media: false, media_urls: [] });
        expect(extractMedia({ extended_entities: { media: [] } })).toEqual({
            has_media: false,
            media_urls: [],
        });
    });

    it('extracts photo urls from extended_entities', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/a.jpg' },
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/b.jpg' },
                ],
            },
        });
        expect(result.has_media).toBe(true);
        expect(result.media_urls).toEqual([
            'https://pbs.twimg.com/media/a.jpg',
            'https://pbs.twimg.com/media/b.jpg',
        ]);
    });

    it('prefers mp4 variant for video and animated_gif', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    {
                        type: 'video',
                        media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
                        video_info: {
                            variants: [
                                { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/x.m3u8' },
                                { content_type: 'video/mp4', url: 'https://video.twimg.com/x.mp4' },
                            ],
                        },
                    },
                    {
                        type: 'animated_gif',
                        media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/g.jpg',
                        video_info: {
                            variants: [
                                { content_type: 'video/mp4', url: 'https://video.twimg.com/g.mp4' },
                            ],
                        },
                    },
                ],
            },
        });
        expect(result.has_media).toBe(true);
        expect(result.media_urls).toEqual([
            'https://video.twimg.com/x.mp4',
            'https://video.twimg.com/g.mp4',
        ]);
    });

    it('falls back to media_url_https when no mp4 variant is available', () => {
        const result = extractMedia({
            extended_entities: {
                media: [
                    {
                        type: 'video',
                        media_url_https: 'https://pbs.twimg.com/media/thumb.jpg',
                        video_info: { variants: [] },
                    },
                ],
            },
        });
        expect(result).toEqual({
            has_media: true,
            media_urls: ['https://pbs.twimg.com/media/thumb.jpg'],
        });
    });

    it('falls back to entities.media when extended_entities is missing', () => {
        const result = extractMedia({
            entities: {
                media: [
                    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/c.jpg' },
                ],
            },
        });
        expect(result).toEqual({
            has_media: true,
            media_urls: ['https://pbs.twimg.com/media/c.jpg'],
        });
    });
});
