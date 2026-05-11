import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './feed.js';

function makePage({ initialData, continuationData, fetchImpl } = {}) {
    const fetchMock = fetchImpl || vi.fn().mockResolvedValue({
        ok: true,
        json: async () => continuationData,
    });

    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            const previousWindow = globalThis.window;
            const previousFetch = globalThis.fetch;

            globalThis.window = {
                ytInitialData: initialData,
                ytcfg: {
                    data_: {
                        INNERTUBE_API_KEY: 'test-key',
                        INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '1.0' } },
                    },
                },
            };
            globalThis.fetch = fetchMock;

            try {
                return await eval(script);
            }
            finally {
                globalThis.window = previousWindow;
                globalThis.fetch = previousFetch;
            }
        }),
        __fetchMock: fetchMock,
    };
}

const initialData = {
    contents: {
        twoColumnBrowseResultsRenderer: {
            tabs: [{
                tabRenderer: {
                    content: {
                        richGridRenderer: {
                            contents: [
                                {
                                    richItemRenderer: {
                                        content: {
                                            videoRenderer: {
                                                videoId: 'first-video',
                                                title: { runs: [{ text: 'First video' }] },
                                                ownerText: { runs: [{ text: 'First channel' }] },
                                                viewCountText: { simpleText: '1K views' },
                                                lengthText: { simpleText: '10:00' },
                                                publishedTimeText: { simpleText: '1 day ago' },
                                            },
                                        },
                                    },
                                },
                                {
                                    continuationItemRenderer: {
                                        continuationEndpoint: {
                                            continuationCommand: {
                                                token: 'next-token',
                                            },
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            }],
        },
    },
};

const continuationData = {
    onResponseReceivedActions: [{
        appendContinuationItemsAction: {
            continuationItems: [{
                richItemRenderer: {
                    content: {
                        videoRenderer: {
                            videoId: 'second-video',
                            title: { runs: [{ text: 'Second video' }] },
                            ownerText: { runs: [{ text: 'Second channel' }] },
                            viewCountText: { simpleText: '2K views' },
                            lengthText: { simpleText: '11:00' },
                            publishedTimeText: { simpleText: '2 days ago' },
                        },
                    },
                },
            }],
        },
    }],
};

afterEach(() => {
    vi.restoreAllMocks();
});

describe('youtube feed', () => {
    it('uses continuation results when the first page is below limit', async () => {
        const page = makePage({ initialData, continuationData });
        const cmd = getRegistry().get('youtube/feed');

        const rows = await cmd.func(page, { limit: 2 });

        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.__fetchMock).toHaveBeenCalledTimes(1);
        expect(rows).toEqual([
            expect.objectContaining({
                rank: 1,
                title: 'First video',
                video_id: 'first-video',
                url: 'https://www.youtube.com/watch?v=first-video',
            }),
            expect.objectContaining({
                rank: 2,
                title: 'Second video',
                video_id: 'second-video',
                url: 'https://www.youtube.com/watch?v=second-video',
            }),
        ]);
    });
});
