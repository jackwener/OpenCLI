import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import './search.js';

function response(payload, { status = 200, jsonError } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: jsonError
            ? vi.fn().mockRejectedValue(jsonError)
            : vi.fn().mockResolvedValue(payload),
    };
}

function makePage({ initialData, responses = [], cookies, loggedIn = true, fetchImpl } = {}) {
    const fetchMock = fetchImpl || vi.fn().mockImplementation(async () => responses.shift());
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue(cookies ?? [{ name: '__Secure-3PAPISID', value: 'secret-cookie' }]),
        evaluate: vi.fn(async (script) => {
            const previousWindow = globalThis.window;
            const previousFetch = globalThis.fetch;
            globalThis.window = {
                ytInitialData: initialData ?? payload([]),
                ytcfg: {
                    data_: {
                        INNERTUBE_API_KEY: 'test-key',
                        INNERTUBE_CONTEXT: { client: { clientName: 'WEB', clientVersion: '1.0' } },
                        LOGGED_IN: loggedIn,
                    },
                    get: (key) => key === 'LOGGED_IN' ? loggedIn : undefined,
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

function text(value) {
    return { runs: [{ text: value }] };
}

function video(id, {
    title = 'First video',
    channel = 'First channel',
    views = '1K views',
    duration = '10:00',
    published = '1 day ago',
    url = `/watch?v=${id}`,
} = {}) {
    return {
        videoRenderer: {
            videoId: id,
            title: text(title),
            ownerText: text(channel),
            viewCountText: { simpleText: views },
            lengthText: { simpleText: duration },
            publishedTimeText: { simpleText: published },
            navigationEndpoint: { commandMetadata: { webCommandMetadata: { url } } },
        },
    };
}

function channel(id = 'channel-id') {
    return {
        channelRenderer: {
            channelId: id,
            title: { simpleText: 'OpenAI' },
            subscriberCountText: { simpleText: '@OpenAI' },
            videoCountText: { simpleText: '2M subscribers' },
            navigationEndpoint: {
                browseEndpoint: { browseId: id, canonicalBaseUrl: '/@OpenAI' },
                commandMetadata: { webCommandMetadata: { url: '/@OpenAI' } },
            },
        },
    };
}

function playlistLockup(id = 'playlist-id') {
    return {
        lockupViewModel: {
            contentId: id,
            contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST',
            metadata: {
                lockupMetadataViewModel: {
                    title: { content: 'OpenAI for Business' },
                    metadata: {
                        contentMetadataViewModel: {
                            metadataRows: [{
                                metadataParts: [
                                    { text: { content: 'OpenAI' } },
                                    { text: { content: 'Playlist' } },
                                ],
                            }],
                        },
                    },
                },
            },
        },
    };
}

function shortLockup(id = 'short-id') {
    return {
        shortsLockupViewModel: {
            onTap: {
                innertubeCommand: {
                    commandMetadata: { webCommandMetadata: { url: `/shorts/${id}` } },
                    reelWatchEndpoint: { videoId: id },
                },
            },
            overlayMetadata: {
                primaryText: { content: 'OpenAI short' },
                secondaryText: { content: '1.1K views' },
            },
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

function message(value) {
    return { messageRenderer: { text: text(value) } };
}

function payload(items, { loggedOut = false } = {}) {
    return {
        responseContext: { mainAppWebResponseContext: { loggedOut } },
        contents: { items },
    };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('youtube search', () => {
    it('paginates authenticated continuations and preserves the seven-column contract', async () => {
        const page = makePage({
            initialData: payload([
                video('first', { url: '/watch?v=first&t=1s' }),
                continuation('next-token'),
            ]),
            responses: [response(payload([
                video('second', {
                    title: 'Second video',
                    channel: 'Second channel',
                    views: '2K views',
                    duration: '11:00',
                    published: '2 days ago',
                }),
                continuation('unused-token'),
            ]))],
        });

        await expect(getRegistry().get('youtube/search').func(page, {
            query: 'open cli',
            limit: 2,
        })).resolves.toEqual([
            {
                rank: 1,
                title: 'First video',
                channel: 'First channel',
                views: '1K views',
                duration: '10:00',
                published: '1 day ago',
                url: 'https://www.youtube.com/watch?v=first&t=1s',
            },
            {
                rank: 2,
                title: 'Second video',
                channel: 'Second channel',
                views: '2K views',
                duration: '11:00',
                published: '2 days ago',
                url: 'https://www.youtube.com/watch?v=second',
            },
        ]);

        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com/results?search_query=open%20cli');
        expect(page.wait).toHaveBeenCalledWith(3);
        expect(page.__fetchMock).toHaveBeenCalledTimes(1);
        const request = page.__fetchMock.mock.calls[0][1];
        expect(JSON.parse(request.body)).toMatchObject({ continuation: 'next-token' });
        expect(request.headers.Authorization).toMatch(/^SAPISIDHASH \d+_[a-f0-9]{40}$/);
        expect(request.headers['X-Origin']).toBe('https://www.youtube.com');
    });

    it('does not fetch an unused cursor after satisfying the limit', async () => {
        const page = makePage({ initialData: payload([video('first'), continuation('unused')]) });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 1 }))
            .resolves.toHaveLength(1);
        expect(page.__fetchMock).not.toHaveBeenCalled();
    });

    it('supports a signed-out public continuation without an Authorization header', async () => {
        const page = makePage({
            loggedIn: false,
            cookies: [],
            initialData: payload([video('first'), continuation('next')], { loggedOut: true }),
            responses: [response(payload([video('second')], { loggedOut: true }))],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .resolves.toHaveLength(2);
        expect(page.__fetchMock.mock.calls[0][1].headers).not.toHaveProperty('Authorization');
    });

    it('requires SAPISID only when a signed-in result needs a continuation', async () => {
        const page = makePage({
            cookies: [],
            initialData: payload([video('first'), continuation('next')]),
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.__fetchMock).not.toHaveBeenCalled();
    });

    it('maps a logged-out continuation from a signed-in page to AuthRequiredError', async () => {
        const page = makePage({
            initialData: payload([video('first'), continuation('next')]),
            responses: [response(payload([video('second')], { loggedOut: true }))],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it.each([0, -1, 1.5, 51, 'bad'])('rejects invalid limit %s before navigation', async (limit) => {
        const page = makePage();
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it.each([
        { query: '' },
        { query: 'test', type: 'movie' },
        { query: 'test', upload: 'decade' },
        { query: 'test', sort: 'popular' },
    ])('rejects invalid args before navigation: %o', async (kwargs) => {
        const page = makePage();
        await expect(getRegistry().get('youtube/search').func(page, kwargs))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('preserves type > upload > sort filter priority', async () => {
        const page = makePage({ initialData: payload([shortLockup()]) });
        await getRegistry().get('youtube/search').func(page, {
            query: 'test',
            type: 'shorts',
            upload: 'today',
            sort: 'views',
            limit: 1,
        });
        expect(page.goto).toHaveBeenCalledWith(
            'https://www.youtube.com/results?search_query=test&sp=EgIQCQ%3D%3D',
        );
    });

    it('normalizes current channel renderer results', async () => {
        const page = makePage({ initialData: payload([channel()]) });
        await expect(getRegistry().get('youtube/search').func(page, {
            query: 'OpenAI', type: 'channel', limit: 1,
        })).resolves.toEqual([{
            rank: 1,
            title: 'OpenAI',
            channel: '@OpenAI',
            views: '2M subscribers',
            duration: 'CHANNEL',
            published: '',
            url: 'https://www.youtube.com/@OpenAI',
        }]);
    });

    it('normalizes current playlist lockup results', async () => {
        const page = makePage({ initialData: payload([playlistLockup()]) });
        await expect(getRegistry().get('youtube/search').func(page, {
            query: 'OpenAI', type: 'playlist', limit: 1,
        })).resolves.toEqual([{
            rank: 1,
            title: 'OpenAI for Business',
            channel: 'OpenAI',
            views: '',
            duration: 'PLAYLIST',
            published: '',
            url: 'https://www.youtube.com/playlist?list=playlist-id',
        }]);
    });

    it('normalizes current shorts lockup results', async () => {
        const page = makePage({ initialData: payload([shortLockup()]) });
        await expect(getRegistry().get('youtube/search').func(page, {
            query: 'OpenAI', type: 'shorts', limit: 1,
        })).resolves.toEqual([{
            rank: 1,
            title: 'OpenAI short',
            channel: '',
            views: '1.1K views',
            duration: 'SHORT',
            published: '',
            url: 'https://www.youtube.com/shorts/short-id',
        }]);
    });

    it.each([
        [response({}, { status: 500 })],
        [response(null, { jsonError: new SyntaxError('bad json') })],
        [response({ error: { code: 400, status: 'INVALID_ARGUMENT' } })],
    ])('maps HTTP, JSON, and upstream failures to CommandExecutionError', async (nextResponse) => {
        const page = makePage({
            initialData: payload([video('first'), continuation('next')]),
            responses: [nextResponse],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps continuation transport failure to CommandExecutionError', async () => {
        const page = makePage({
            initialData: payload([video('first'), continuation('next')]),
            fetchImpl: vi.fn().mockRejectedValue(new Error('network down')),
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps a signed-out HTTP 403 to CommandExecutionError instead of an auth failure', async () => {
        const page = makePage({
            loggedIn: false,
            cookies: [],
            initialData: payload([video('first'), continuation('next')], { loggedOut: true }),
            responses: [response({}, { status: 403 })],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it.each([401, 403])('maps signed-in HTTP %s to AuthRequiredError', async (status) => {
        const page = makePage({
            initialData: payload([video('first'), continuation('next')]),
            responses: [response({}, { status })],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps request timeout to TimeoutError', async () => {
        const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
        const page = makePage({
            initialData: payload([video('first'), continuation('next')]),
            fetchImpl: vi.fn().mockRejectedValue(timeout),
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(TimeoutError);
    });

    it('rejects a repeated continuation cursor instead of returning partial rows', async () => {
        const page = makePage({
            initialData: payload([video('first'), continuation('same')]),
            responses: [response(payload([video('first'), continuation('same')]))],
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects the page cap instead of returning accumulated partial rows', async () => {
        const responses = Array.from({ length: 10 }, (_, index) =>
            response(payload([continuation(`cursor-${index + 1}`)])));
        const page = makePage({
            initialData: payload([video('first'), continuation('cursor-0')]),
            responses,
        });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 2 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.__fetchMock).toHaveBeenCalledTimes(10);
    });

    it('rejects malformed rows instead of silently dropping them', async () => {
        const page = makePage({ initialData: payload([video('first', { title: '' })]) });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'test', limit: 1 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('reports valid empty results as EmptyResultError', async () => {
        const page = makePage({ initialData: payload([message('No results found')]) });
        await expect(getRegistry().get('youtube/search').func(page, { query: 'nothing', limit: 1 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
