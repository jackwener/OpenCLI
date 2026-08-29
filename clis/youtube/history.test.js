import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import './history.js';

function response(payload, { status = 200, jsonError } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: jsonError
            ? vi.fn().mockRejectedValue(jsonError)
            : vi.fn().mockResolvedValue(payload),
    };
}

function makePage({ responses = [], cookies, fetchImpl } = {}) {
    const fetchMock = fetchImpl || vi.fn().mockImplementation(async () => responses.shift());
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookies ?? [{ name: '__Secure-3PAPISID', value: 'secret-cookie' }]),
        evaluate: vi.fn(async (script) => {
            const previousWindow = globalThis.window;
            const previousFetch = globalThis.fetch;
            globalThis.window = {
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

function lockup(id, {
    title = 'First video',
    channel = 'First channel',
    views = '1K views',
    duration = '10:00',
    url = `/watch?v=${id}`,
} = {}) {
    return {
        lockupViewModel: {
            contentId: id,
            contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
            metadata: {
                lockupMetadataViewModel: {
                    title: { content: title },
                    metadata: {
                        contentMetadataViewModel: {
                            metadataRows: [{
                                metadataParts: [
                                    { text: { content: channel } },
                                    { text: { content: views } },
                                ],
                            }],
                        },
                    },
                },
            },
            contentImage: {
                thumbnailViewModel: {
                    overlays: [{
                        thumbnailBottomOverlayViewModel: {
                            badges: [{ thumbnailBadgeViewModel: { text: duration } }],
                        },
                    }],
                },
            },
            rendererContext: {
                commandContext: {
                    onTap: {
                        innertubeCommand: {
                            commandMetadata: { webCommandMetadata: { url } },
                        },
                    },
                },
            },
        },
    };
}

function videoRenderer(id, {
    title = 'Second video',
    channel = 'Second channel',
    views = '2K views',
    duration = '11:00',
    url = `/watch?v=${id}`,
} = {}) {
    return {
        videoRenderer: {
            videoId: id,
            title: { runs: [{ text: title }] },
            ownerText: { runs: [{ text: channel }] },
            viewCountText: { simpleText: views },
            lengthText: { simpleText: duration },
            navigationEndpoint: { commandMetadata: { webCommandMetadata: { url } } },
        },
    };
}

function continuation(token) {
    return {
        continuationItemRenderer: {
            continuationEndpoint: { continuationCommand: { token } },
        },
    };
}

function initialPayload(items, { loggedOut = false } = {}) {
    return {
        responseContext: { mainAppWebResponseContext: { loggedOut } },
        contents: {
            twoColumnBrowseResultsRenderer: {
                tabs: [{
                    tabRenderer: {
                        content: {
                            sectionListRenderer: {
                                contents: [{ itemSectionRenderer: { contents: items } }],
                            },
                        },
                    },
                }],
            },
        },
    };
}

function continuationPayload(items) {
    return {
        onResponseReceivedActions: [{
            appendContinuationItemsAction: { continuationItems: items },
        }],
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('youtube history', () => {
    it('uses authenticated FEhistory pagination and preserves the public row contract', async () => {
        const page = makePage({
            responses: [
                response(initialPayload([
                    lockup('first', { url: '/watch?v=first&t=1s' }),
                    continuation('next-token'),
                ])),
                response(continuationPayload([
                    videoRenderer('second'),
                    continuation('unused-token'),
                ])),
            ],
        });

        await expect(getRegistry().get('youtube/history').func(page, { limit: 2 })).resolves.toEqual([
            {
                rank: 1,
                title: 'First video',
                channel: 'First channel',
                views: '1K views',
                duration: '10:00',
                url: 'https://www.youtube.com/watch?v=first&t=1s',
            },
            {
                rank: 2,
                title: 'Second video',
                channel: 'Second channel',
                views: '2K views',
                duration: '11:00',
                url: 'https://www.youtube.com/watch?v=second',
            },
        ]);

        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com', { waitUntil: 'none' });
        expect(page.wait).toHaveBeenCalledWith(2);
        expect(page.__fetchMock).toHaveBeenCalledTimes(2);
        const firstRequest = page.__fetchMock.mock.calls[0][1];
        const secondRequest = page.__fetchMock.mock.calls[1][1];
        expect(JSON.parse(firstRequest.body)).toMatchObject({ browseId: 'FEhistory' });
        expect(JSON.parse(secondRequest.body)).toMatchObject({ continuation: 'next-token' });
        expect(firstRequest.headers.Authorization).toMatch(/^SAPISIDHASH \d+_[a-f0-9]{40}$/);
        expect(firstRequest.headers['X-Origin']).toBe('https://www.youtube.com');
    });

    it('does not follow an unused cursor after satisfying the requested limit', async () => {
        const page = makePage({
            responses: [response(initialPayload([lockup('first'), continuation('unused-token')]))],
        });

        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 })).resolves.toHaveLength(1);
        expect(page.__fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each([0, -1, 1.5, 201, 'bad'])('rejects invalid limit %s', async (limit) => {
        const page = makePage();
        await expect(getRegistry().get('youtube/history').func(page, { limit }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('requires a SAPISID cookie before evaluating page code', async () => {
        const page = makePage({ cookies: [] });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it.each([
        [response(initialPayload([], { loggedOut: true }))],
        [response({}, { status: 401 })],
        [response({ error: { code: 403, status: 'PERMISSION_DENIED' } })],
    ])('classifies signed-out and rejected responses as AuthRequiredError', async (firstResponse) => {
        const page = makePage({ responses: [firstResponse] });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it.each([
        [response({}, { status: 500 })],
        [response(null, { jsonError: new SyntaxError('bad json') })],
        [response({ error: { code: 400, status: 'INVALID_ARGUMENT' } })],
    ])('classifies HTTP, JSON, and upstream failures as CommandExecutionError', async (firstResponse) => {
        const page = makePage({ responses: [firstResponse] });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('classifies request timeout as TimeoutError', async () => {
        const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        const page = makePage({ fetchImpl: vi.fn().mockRejectedValue(timeout) });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(TimeoutError);
    });

    it('rejects a repeated continuation cursor instead of returning partial rows', async () => {
        const page = makePage({
            responses: [
                response(initialPayload([lockup('first'), continuation('same-token')])),
                response(continuationPayload([lockup('first'), continuation('same-token')])),
            ],
        });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects malformed video rows instead of silently dropping them', async () => {
        const page = makePage({
            responses: [response(initialPayload([lockup('first', { title: '' })]))],
        });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('reports a valid empty history as EmptyResultError', async () => {
        const payload = initialPayload([]);
        payload.contents.twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
            .sectionListRenderer.contents[0].itemSectionRenderer.contents = [{
                messageRenderer: { text: { runs: [{ text: 'No watch history' }] } },
            }];
        const page = makePage({ responses: [response(payload)] });
        await expect(getRegistry().get('youtube/history').func(page, { limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
