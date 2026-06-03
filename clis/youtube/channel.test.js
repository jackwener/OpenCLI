import { describe, expect, it } from 'vitest';
import { __test__ } from './channel.js';

function tab(title, contents, selected = false) {
    return {
        tabRenderer: {
            title,
            selected,
            content: {
                richGridRenderer: {
                    contents,
                },
            },
        },
    };
}

function browseData(tabs) {
    return {
        contents: {
            twoColumnBrowseResultsRenderer: {
                tabs,
            },
        },
    };
}

describe('youtube channel helpers', () => {
    it('uses the selected rich-grid tab instead of the first tab', () => {
        const home = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'home' } } } }];
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'videos' } } } }];

        expect(__test__.extractSelectedRichGridContents(browseData([
            tab('Home', home),
            tab('Videos', videos, true),
        ]))).toBe(videos);
    });

    it('falls back to the first non-empty rich-grid tab when no tab is selected', () => {
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'only' } } } }];

        expect(__test__.extractSelectedRichGridContents(browseData([
            tab('Home', []),
            tab('Videos', videos),
        ]))).toBe(videos);
    });

    it('is self-contained for browser evaluate injection', () => {
        const extractSelectedRichGridContents = Function(
            `return ${__test__.extractSelectedRichGridContents.toString()}`
        )();
        const videos = [{ richItemRenderer: { content: { videoRenderer: { videoId: 'serialized' } } } }];

        expect(extractSelectedRichGridContents(browseData([
            tab('Home', []),
            tab('Videos', videos, true),
        ]))).toEqual(videos);
    });
});

describe('parseVideoItem', () => {
    it('parses lockupViewModel format', () => {
        const item = {
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        contentId: 'abc123',
                        metadata: {
                            lockupMetadataViewModel: {
                                title: { content: 'Test Video' },
                                metadata: {
                                    contentMetadataViewModel: {
                                        metadataRows: [
                                            { metadataParts: [{ text: { content: '10K views' } }, { text: { content: '2 days ago' } }] },
                                        ],
                                    },
                                },
                            },
                        },
                        contentImage: {
                            thumbnailViewModel: {
                                overlays: [
                                    { thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: '12:34' } }] } },
                                ],
                            },
                        },
                    },
                },
            },
        };
        const result = __test__.parseVideoItem(item);
        expect(result).toEqual({
            title: 'Test Video',
            duration: '12:34',
            views: '10K views | 2 days ago',
            url: 'https://www.youtube.com/watch?v=abc123',
        });
    });

    it('parses legacy videoRenderer format', () => {
        const item = {
            richItemRenderer: {
                content: {
                    videoRenderer: {
                        videoId: 'xyz789',
                        title: { runs: [{ text: 'Legacy Video' }] },
                        lengthText: { simpleText: '5:00' },
                        shortViewCountText: { simpleText: '1K views' },
                        publishedTimeText: { simpleText: '3 days ago' },
                    },
                },
            },
        };
        const result = __test__.parseVideoItem(item);
        expect(result).toEqual({
            title: 'Legacy Video',
            duration: '5:00',
            views: '1K views | 3 days ago',
            url: 'https://www.youtube.com/watch?v=xyz789',
        });
    });

    it('returns null for non-video items', () => {
        expect(__test__.parseVideoItem({})).toBeNull();
        expect(__test__.parseVideoItem({ richItemRenderer: { content: {} } })).toBeNull();
        expect(__test__.parseVideoItem({
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
                        contentId: 'playlist-id',
                        metadata: { lockupMetadataViewModel: { title: { content: 'Playlist' } } },
                    },
                },
            },
        })).toBeNull();
    });

    it('requires stable video identity before emitting a watch URL', () => {
        expect(__test__.parseVideoItem({
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        metadata: { lockupMetadataViewModel: { title: { content: 'Missing id' } } },
                    },
                },
            },
        })).toBeNull();
        expect(__test__.parseVideoItem({
            richItemRenderer: {
                content: {
                    videoRenderer: {
                        videoId: 'bad id with spaces',
                        title: { simpleText: 'Bad id' },
                    },
                },
            },
        })).toBeNull();
        expect(__test__.parseVideoItem({
            richItemRenderer: {
                content: {
                    videoRenderer: {
                        videoId: 'no-title-id',
                    },
                },
            },
        })).toBeNull();
    });

    it('handles lockupViewModel without duration overlay', () => {
        const item = {
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        contentId: 'nodur',
                        metadata: {
                            lockupMetadataViewModel: {
                                title: { content: 'No Duration' },
                                metadata: { contentMetadataViewModel: { metadataRows: [] } },
                            },
                        },
                        contentImage: { thumbnailViewModel: { overlays: [] } },
                    },
                },
            },
        };
        const result = __test__.parseVideoItem(item);
        expect(result.duration).toBe('');
        expect(result.title).toBe('No Duration');
    });

    it('parses the Home tab direct lockupViewModel and gridVideoRenderer shapes', () => {
        expect(__test__.parseVideoItem({
            lockupViewModel: {
                contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                contentId: 'homeLockup',
                metadata: {
                    lockupMetadataViewModel: {
                        title: { content: 'Home Lockup' },
                        metadata: {
                            contentMetadataViewModel: {
                                metadataRows: [
                                    { metadataParts: [{ text: { content: '7K views' } }, { text: { content: '1 day ago' } }] },
                                ],
                            },
                        },
                    },
                },
                contentImage: { thumbnailViewModel: { overlays: [] } },
            },
        })).toMatchObject({
            title: 'Home Lockup',
            views: '7K views | 1 day ago',
            url: 'https://www.youtube.com/watch?v=homeLockup',
        });
        expect(__test__.parseVideoItem({
            gridVideoRenderer: {
                videoId: 'gridVideo1',
                title: { simpleText: 'Grid Video' },
                thumbnailOverlays: [
                    { thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '9:10' } } },
                ],
            },
        })).toMatchObject({
            title: 'Grid Video',
            duration: '9:10',
            url: 'https://www.youtube.com/watch?v=gridVideo1',
        });
    });

    it('prefers lockupViewModel over videoRenderer', () => {
        const item = {
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        contentId: 'lockup-id',
                        metadata: {
                            lockupMetadataViewModel: {
                                title: { content: 'Lockup Title' },
                                metadata: { contentMetadataViewModel: { metadataRows: [] } },
                            },
                        },
                        contentImage: { thumbnailViewModel: { overlays: [] } },
                    },
                    videoRenderer: {
                        videoId: 'legacy-id',
                        title: { runs: [{ text: 'Legacy Title' }] },
                        lengthText: { simpleText: '1:00' },
                    },
                },
            },
        };
        const result = __test__.parseVideoItem(item);
        expect(result.url).toContain('lockup-id');
        expect(result.title).toBe('Lockup Title');
    });

    it('is self-contained for browser evaluate injection', () => {
        const parseVideoItem = Function(`return ${__test__.parseVideoItem.toString()}`)();
        const item = {
            richItemRenderer: {
                content: {
                    lockupViewModel: {
                        contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
                        contentId: 'injected',
                        metadata: {
                            lockupMetadataViewModel: {
                                title: { content: 'Injected' },
                                metadata: { contentMetadataViewModel: { metadataRows: [] } },
                            },
                        },
                        contentImage: { thumbnailViewModel: { overlays: [] } },
                    },
                },
            },
        };
        expect(parseVideoItem(item).url).toContain('injected');
    });
});
