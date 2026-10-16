import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './user.js';

let cmd;
beforeAll(() => {
    cmd = getRegistry().get('instagram/user');
    expect(cmd?.func).toBeTypeOf('function');
});

afterEach(() => {
    vi.restoreAllMocks();
});

let nextPk = 0;
function post(caption = 'post', pk) {
    nextPk += 1;
    return { pk: String(pk ?? nextPk), caption: { text: caption }, like_count: 1, comment_count: 0, media_type: 1 };
}

function timelineResponse(nodes, pageInfo) {
    return {
        data: {
            xdt_api__v1__feed__user_timeline_graphql_connection: {
                edges: nodes.map((node) => ({ node })),
                ...(pageInfo ? { page_info: pageInfo } : {}),
            },
        },
    };
}

function captureTimeout() {
    return new Error('No network capture within 15s');
}

function createPageMock({ drains = [], waits = [], pathname, envelope = false } = {}, calls = []) {
    const drainQueue = [...drains];
    const waitQueue = [...waits];
    let routed = '/natgeo/';
    return {
        goto: vi.fn(async (url) => { calls.push(`goto:${url.includes('__opencli_reset') ? 'reset' : 'home'}`); }),
        wait: vi.fn(async () => {}),
        installInterceptor: vi.fn(async (pattern) => { calls.push(`install:${pattern}`); }),
        autoScroll: vi.fn(async (options) => { calls.push(`scroll:${options?.times}`); }),
        waitForCapture: vi.fn(async () => {
            calls.push('capture');
            const next = waitQueue.length ? waitQueue.shift() : null;
            if (next)
                throw next;
            // Mirror the real wait: with nothing left to deliver it expires
            // rather than resolving forever.
            if (drainQueue.length === 0)
                throw captureTimeout();
        }),
        getInterceptedRequests: vi.fn(async () => (drainQueue.length ? drainQueue.shift() : [])),
        evaluate: vi.fn(async (script) => {
            if (script.includes('history.pushState')) {
                calls.push('route');
                routed = script.match(/"([^"]+)"/)?.[1] ?? routed;
                return undefined;
            }
            calls.push('read-path');
            const value = pathname ?? routed;
            return envelope ? { session: 'site:instagram:test', data: value } : value;
        }),
    };
}

describe('instagram user timeline', () => {
    it('maps the intercepted timeline into post rows', async () => {
        const page = createPageMock({
            drains: [[
                { data: { other_field: {} } },
                timelineResponse([
                    { pk: '1', caption: { text: 'First post\nwith newline' }, like_count: 12, comment_count: 3, media_type: 1, taken_at: 1784451600 },
                    { pk: '2', caption: { text: 'Second post' }, like_count: 4, comment_count: 1, media_type: 2 },
                    { pk: '3', caption: null, like_count: 0, comment_count: 0, media_type: 8 },
                ]),
            ]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 3 })).resolves.toEqual([
            { index: 1, caption: 'First post with newline', likes: 12, comments: 3, type: 'photo', date: new Date(1784451600 * 1000).toLocaleDateString() },
            { index: 2, caption: 'Second post', likes: 4, comments: 1, type: 'video', date: '' },
            { index: 3, caption: '', likes: 0, comments: 0, type: 'carousel', date: '' },
        ]);
    });

    it('forces a fresh document and installs the interceptor before routing', async () => {
        const calls = [];
        const page = createPageMock({ drains: [[timelineResponse([post()])]] }, calls);

        await cmd.func(page, { username: 'natgeo', limit: 1 });

        expect(calls.slice(0, 4)).toEqual(['goto:reset', 'goto:home', 'install:/graphql/query', 'route']);
    });

    it('keeps draining until the timeline capture arrives', async () => {
        const page = createPageMock({
            drains: [
                [{ data: { some_other_query: {} } }],
                [{ data: { another_query: {} } }],
                [timelineResponse([post('late')])],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 1 })).resolves.toEqual([
            expect.objectContaining({ caption: 'late' }),
        ]);
        expect(page.getInterceptedRequests).toHaveBeenCalledTimes(3);
    });

    it('reads the settled pathname only after the capture window closes', async () => {
        const calls = [];
        const page = createPageMock({ drains: [[]], waits: [captureTimeout()], pathname: '/accounts/login/' }, calls);

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/Could not route to \/natgeo\//);
        expect(calls.indexOf('read-path')).toBeGreaterThan(calls.lastIndexOf('capture'));
    });

    it('paginates across several pages until the limit is reached', async () => {
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), post('b')], { has_next_page: true })],
                [timelineResponse([post('c')], { has_next_page: true })],
                [timelineResponse([post('d')], { has_next_page: false })],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 4 })).resolves.toHaveLength(4);
        expect(page.autoScroll).toHaveBeenCalledTimes(2);
        expect(page.autoScroll).toHaveBeenCalledWith(expect.objectContaining({ times: 1 }));
    });

    it('skips posts a later page repeats', async () => {
        const repeated = post('shared', 99);
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), repeated], { has_next_page: true })],
                [timelineResponse([repeated, post('c')], { has_next_page: false })],
            ],
        });

        const rows = await cmd.func(page, { username: 'natgeo', limit: 5 });

        expect(rows.map((row) => row.caption)).toEqual(['a', 'shared', 'c']);
    });

    it('stops paginating when a later page reports no continuation', async () => {
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), post('b')], { has_next_page: true })],
                [timelineResponse([post('c')])],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 5 })).resolves.toHaveLength(3);
    });

    it('drains past an unrelated capture while paginating instead of ending the feed', async () => {
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a')], { has_next_page: true })],
                [{ data: { unrelated_query: {} } }],
                [timelineResponse([post('b')], { has_next_page: false })],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).resolves.toHaveLength(2);
    });

    it('ends cleanly when the last page repeats posts and reports no continuation', async () => {
        const repeated = post('shared', 77);
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), repeated], { has_next_page: true })],
                [timelineResponse([repeated], { has_next_page: false })],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 9 })).resolves.toHaveLength(2);
    });

    it('ends cleanly when the last page is empty and reports no continuation', async () => {
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), post('b')], { has_next_page: true })],
                [timelineResponse([], { has_next_page: false })],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 9 })).resolves.toHaveLength(2);
    });

    it('stops waiting as soon as the last page reports no continuation', async () => {
        const page = createPageMock({
            drains: [
                [timelineResponse([post('a'), post('b')], { has_next_page: true })],
                [timelineResponse([], { has_next_page: false })],
            ],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 9 })).resolves.toHaveLength(2);
        expect(page.waitForCapture).toHaveBeenCalledTimes(2);
    });

    it('does not scroll once the limit is already satisfied', async () => {
        const page = createPageMock({
            drains: [[timelineResponse(Array.from({ length: 12 }, () => post()), { has_next_page: true })]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).resolves.toHaveLength(2);
        expect(page.autoScroll).not.toHaveBeenCalled();
    });

    it('routes to the requested handle, preserving its case', async () => {
        const page = createPageMock({ drains: [[timelineResponse([post()])]], pathname: '/NatGeo/' });

        await cmd.func(page, { username: 'NatGeo', limit: 1 });

        const routeScript = page.evaluate.mock.calls.map(([script]) => script).find((script) => script.includes('history.pushState'));
        expect(routeScript).toContain('"/NatGeo/"');
    });

    it('accepts a settled pathname whose case differs from the requested handle', async () => {
        const page = createPageMock({ drains: [[timelineResponse([post()])]], pathname: '/natgeo/' });

        await expect(cmd.func(page, { username: 'NatGeo', limit: 1 })).resolves.toHaveLength(1);
    });

    it('typed-fails when the settled pathname is not a string', async () => {
        const page = createPageMock({ drains: [[timelineResponse([post()])]] });
        page.evaluate = vi.fn(async (script) => (script.includes('history.pushState') ? undefined : 42));

        await expect(cmd.func(page, { username: 'natgeo', limit: 1 })).rejects.toThrow(/Could not route to \/natgeo\//);
    });

    it('bounds every capture wait by the remaining budget', async () => {
        const page = createPageMock({ drains: [[timelineResponse([post()])]] });

        await cmd.func(page, { username: 'natgeo', limit: 1 });

        for (const [seconds] of page.waitForCapture.mock.calls) {
            expect(seconds).toBeGreaterThan(0);
            expect(seconds).toBeLessThanOrEqual(15);
        }
    });

    it('keeps an unrelated query error from aborting a run whose timeline arrived', async () => {
        const page = createPageMock({
            drains: [[
                timelineResponse([post('a')], { has_next_page: false }),
                { data: { xdt_some_other_query: null }, errors: [{ message: 'Field unavailable' }] },
            ]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 1 })).resolves.toHaveLength(1);
    });

    it('typed-fails on a media id that is not an Instagram id', async () => {
        const page = createPageMock({
            drains: [[timelineResponse([{ pk: { nested: true }, caption: { text: 'bad id' }, like_count: 0, comment_count: 0, media_type: 1 }])]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/edge #1 carried no usable media id/);
    });

    it('typed-fails when the continuation never arrives', async () => {
        const page = createPageMock({
            drains: [[timelineResponse([post('a')], { has_next_page: true })]],
            waits: [null, captureTimeout()],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 5 })).rejects.toMatchObject({
            name: 'TimeoutError',
            code: 'TIMEOUT',
            exitCode: 75,
        });
    });

    it('typed-fails instead of under-delivering when the page cap is reached', async () => {
        const page = createPageMock({
            drains: Array.from({ length: 8 }, () => [timelineResponse([post()], { has_next_page: true })]),
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 50 })).rejects.toThrow(/exceeded 5 pages/);
    });

    it('rethrows a transport failure instead of reporting a missing timeline', async () => {
        const page = createPageMock({ drains: [[]], waits: [new Error('Extension disconnected')] });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/Extension disconnected/);
    });

    it('typed-fails on a GraphQL error payload instead of calling it an absent timeline', async () => {
        const page = createPageMock({ drains: [[{ data: null, errors: [{ message: 'Please wait a few minutes' }] }]] });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/Instagram GraphQL error: Please wait a few minutes/);
    });

    it('caps the rows at the requested limit', async () => {
        const page = createPageMock({
            drains: [[timelineResponse(Array.from({ length: 12 }, () => post()))]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).resolves.toHaveLength(2);
    });

    it('unwraps a bridge envelope when reading the settled pathname', async () => {
        const page = createPageMock({ drains: [[]], waits: [captureTimeout()], envelope: true });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/no timeline response/);
    });

    it('rejects a limit that is not a positive integer before opening the browser', async () => {
        for (const limit of [0, -1, 2.5, Number.NaN, undefined]) {
            const page = createPageMock();
            await expect(cmd.func(page, { username: 'natgeo', limit })).rejects.toBeInstanceOf(ArgumentError);
            expect(page.goto).not.toHaveBeenCalled();
        }
    });

    it('rejects handles that are not Instagram usernames before opening the browser', async () => {
        for (const username of ['bad/../handle', '...', '', 'a'.repeat(31), 'has space']) {
            const page = createPageMock();
            await expect(cmd.func(page, { username, limit: 2 })).rejects.toBeInstanceOf(ArgumentError);
            expect(page.goto).not.toHaveBeenCalled();
        }
    });

    it('accepts dotted, underscored and mixed-case handles', async () => {
        for (const username of ['k.mbappe', 'nasa_hq', 'NatGeo', '@natgeo']) {
            const page = createPageMock({ drains: [[timelineResponse([post()])]] });
            await expect(cmd.func(page, { username, limit: 1 })).resolves.toHaveLength(1);
        }
    });

    it('typed-fails when the router settled but no timeline response arrived', async () => {
        const page = createPageMock({ drains: [[{ data: { other_field: {} } }]], waits: [null, captureTimeout()] });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/no timeline response/);
    });

    it('typed-fails when the interceptor returns a non-array', async () => {
        const page = createPageMock({ drains: [[]] });
        page.getInterceptedRequests = vi.fn(async () => null);

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/malformed responses/);
    });

    it('typed-fails on a timeline response whose edges are not an array', async () => {
        const page = createPageMock({
            drains: [[{ data: { xdt_api__v1__feed__user_timeline_graphql_connection: { edges: null } } }]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/no edges array/);
    });

    it('typed-fails on an edge that carries no media node instead of dropping it', async () => {
        const page = createPageMock({
            drains: [[{
                data: {
                    xdt_api__v1__feed__user_timeline_graphql_connection: { edges: [{ node: post() }, { node: null }] },
                },
            }]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 5 })).rejects.toThrow(/edge #2 carried no media node/);
    });

    it('typed-fails on an unsupported media_type instead of guessing a kind', async () => {
        const page = createPageMock({
            drains: [[timelineResponse([{ pk: '7', caption: { text: 'new kind' }, like_count: 0, comment_count: 0, media_type: 99 }])]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/post #1 returned unsupported media_type 99/);
    });

    it('typed-fails on a media node that carries no id', async () => {
        const page = createPageMock({
            drains: [[timelineResponse([{ caption: { text: 'no id' }, like_count: 0, comment_count: 0, media_type: 1 }])]],
        });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toThrow(/edge #1 carried no usable media id/);
    });

    it('raises EmptyResultError when the timeline is empty', async () => {
        const page = createPageMock({ drains: [[timelineResponse([])]] });

        await expect(cmd.func(page, { username: 'natgeo', limit: 2 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('requires a browser session', async () => {
        await expect(cmd.func(null, { username: 'natgeo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
