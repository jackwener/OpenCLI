import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { mockRequestJson, mockLoadCredentials } = vi.hoisted(() => ({
    mockRequestJson: vi.fn(),
    mockLoadCredentials: vi.fn(),
}));

vi.mock('./auth.js', async () => ({
    ...(await vi.importActual('./auth.js')),
    requestXiaoyuzhouJson: mockRequestJson,
    loadXiaoyuzhouCredentials: mockLoadCredentials,
}));

await import('./history.js');

const IDS = {
    a: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    b: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    c: 'cccccccccccccccccccccccc',
    d: 'dddddddddddddddddddddddd',
};
const PIDS = {
    a: '111111111111111111111111',
    b: '222222222222222222222222',
    c: '333333333333333333333333',
    d: '444444444444444444444444',
};

let command;

beforeAll(() => {
    command = getRegistry().get('xiaoyuzhou/history');
    expect(command?.func).toBeTypeOf('function');
});

function historyRow(key, overrides = {}) {
    return {
        episode: {
            eid: IDS[key],
            pid: PIDS[key],
            title: `Episode ${key.toUpperCase()}`,
            duration: 100,
            pubDate: '2026-08-01T00:00:00.000Z',
            isFinished: false,
            podcast: { title: 'Example Podcast' },
            ...overrides,
        },
    };
}

function progressRow(key, overrides = {}) {
    return {
        eid: IDS[key],
        pid: PIDS[key],
        progress: 25,
        playedAt: '2026-08-03T01:02:03.000Z',
        ...overrides,
    };
}

function rootPage(rows, loadMoreKey, credentials = {}) {
    return { data: rows, raw: { data: rows, loadMoreKey }, credentials };
}

function nestedPage(rows, loadMoreKey, credentials = {}) {
    const data = { data: rows, loadMoreKey };
    return { data, raw: { data }, credentials };
}

describe('xiaoyuzhou history', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
        mockLoadCredentials.mockReset();
        mockLoadCredentials.mockReturnValue({ access_token: 'access', refresh_token: 'refresh' });
    });

    it('accepts both evidenced envelopes and enriches each page before fetching the next', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a')], 'next', { token: 'history-1' }))
            .mockResolvedValueOnce({ data: [progressRow('a')], credentials: { token: 'progress-1' } })
            .mockResolvedValueOnce(nestedPage([historyRow('b', { isFinished: true })], null, { token: 'history-2' }))
            .mockResolvedValueOnce({ data: [progressRow('b', { progress: 50 })], credentials: { token: 'progress-2' } });

        const rows = await command.func({ limit: 2, all: false, 'max-pages': 10 });

        expect(mockRequestJson).toHaveBeenNthCalledWith(1, '/v1/episode-played/list-history', {
            method: 'POST', body: {}, credentials: { access_token: 'access', refresh_token: 'refresh' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(2, '/v1/playback-progress/list', {
            method: 'POST', body: { eids: [IDS.a] }, credentials: { token: 'history-1' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(3, '/v1/episode-played/list-history', {
            method: 'POST', body: { loadMoreKey: 'next' }, credentials: { token: 'progress-1' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(4, '/v1/playback-progress/list', {
            method: 'POST', body: { eids: [IDS.b] }, credentials: { token: 'history-2' },
        });
        expect(rows.map((row) => [row.eid, row.pid])).toEqual([[IDS.a, PIDS.a], [IDS.b, PIDS.b]]);
        expect(rows[0]).toMatchObject({ rank: 1, progressSec: 25, progressPct: 25, finished: false });
        expect(rows[1]).toMatchObject({ rank: 2, progressSec: 50, progressPct: 50, finished: true });
    });

    it('preserves server order across pages and validates rows beyond the requested limit', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('b'), historyRow('a')], 'next', { page: 1 }))
            .mockResolvedValueOnce({ data: [progressRow('b'), progressRow('a')], credentials: { progress: 1 } })
            .mockResolvedValueOnce(rootPage([historyRow('c'), { episode: { eid: IDS.d } }], null, { page: 2 }));

        await expect(command.func({ limit: 3, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('row 2'),
        });
        expect(mockRequestJson).toHaveBeenCalledTimes(3);
    });

    it('rejects a missing duration instead of treating it as explicit null', async () => {
        mockRequestJson.mockResolvedValueOnce(rootPage([historyRow('a', { duration: undefined })], null));
        await expect(command.func({ limit: 1, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC', message: expect.stringContaining('invalid duration'),
        });
        expect(mockRequestJson).toHaveBeenCalledTimes(1);
    });

    it('exhausts --all and ignores --limit without silently deduplicating', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a')], 'next', { page: 1 }))
            .mockResolvedValueOnce({ data: [progressRow('a')], credentials: { progress: 1 } })
            .mockResolvedValueOnce(rootPage([historyRow('b')], null, { page: 2 }))
            .mockResolvedValueOnce({ data: [progressRow('b')], credentials: { progress: 2 } });

        const rows = await command.func({ limit: 'ignored', all: true, 'max-pages': 10 });
        expect(rows.map((row) => row.eid)).toEqual([IDS.a, IDS.b]);

        mockRequestJson.mockReset();
        mockRequestJson.mockResolvedValueOnce(rootPage([historyRow('a'), historyRow('a')], null));
        await expect(command.func({ all: true, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('event-vs-overlap semantics are ambiguous'),
        });
    });

    it.each([
        [{ all: 'true', limit: 20, 'max-pages': 10 }, '--all'],
        [{ all: false, limit: 0, 'max-pages': 10 }, '--limit'],
        [{ all: false, limit: 20, 'max-pages': 1001 }, '--max-pages'],
    ])('rejects invalid arguments before credentials or network (%s)', async (args, message) => {
        await expect(command.func(args)).rejects.toMatchObject({ code: 'ARGUMENT', message: expect.stringContaining(message) });
        expect(mockLoadCredentials).not.toHaveBeenCalled();
        expect(mockRequestJson).not.toHaveBeenCalled();
    });

    it.each([
        ['unexpected envelope', { data: { rows: [] }, raw: {} }, 'unexpected response shape'],
        ['conflicting root and nested cursors', (() => {
            const data = { data: [historyRow('a')], loadMoreKey: null };
            return { data, raw: { data, loadMoreKey: 'conflict' } };
        })(), 'unexpected response shape'],
        ['empty page with cursor', rootPage([], 'next'), 'empty page with a continuation cursor'],
        ['invalid cursor', rootPage([historyRow('a')], { page: 2 }), 'invalid loadMoreKey'],
    ])('fails closed for %s', async (_label, response, message) => {
        mockRequestJson.mockResolvedValueOnce(response);
        await expect(command.func({ limit: 1, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC', message: expect.stringContaining(message),
        });
    });

    it('fails on a repeated cursor before returning a partial result', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a')], 'same', { page: 1 }))
            .mockResolvedValueOnce({ data: [progressRow('a')], credentials: { progress: 1 } })
            .mockResolvedValueOnce(rootPage([historyRow('b')], 'same', { page: 2 }))
            .mockResolvedValueOnce({ data: [progressRow('b')], credentials: { progress: 2 } });
        await expect(command.func({ limit: 3, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC', message: expect.stringContaining('repeated the same cursor'),
        });
    });

    it('fails instead of returning a partial archive at --max-pages', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a')], 'more', { page: 1 }))
            .mockResolvedValueOnce({ data: [progressRow('a')], credentials: { progress: 1 } });
        await expect(command.func({ all: true, 'max-pages': 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC', message: expect.stringContaining('before reaching the end'),
        });
    });

    it.each([
        ['wrong shape', { data: { rows: [] } }, 'unexpected response shape'],
        ['extra eid', { data: [progressRow('b')] }, 'unrequested eid'],
        ['duplicate eid', { data: [progressRow('a'), progressRow('a')] }, 'duplicate eid'],
        ['pid mismatch', { data: [progressRow('a', { pid: PIDS.b })] }, 'pid did not match'],
        ['negative progress', { data: [progressRow('a', { progress: -1 })] }, 'invalid progress'],
        ['missing progress', { data: [progressRow('a', { progress: undefined })] }, 'invalid progress'],
        ['missing playedAt', { data: [progressRow('a', { playedAt: undefined })] }, 'invalid playedAt'],
        ['progress beyond duration', { data: [progressRow('a', { progress: 101 })] }, 'exceeded duration'],
        ['missing requested eid', { data: [] }, 'history join is incomplete'],
    ])('fails closed for playback progress %s', async (_label, progressResponse, message) => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a')], null, { history: 1 }))
            .mockResolvedValueOnce({ ...progressResponse, credentials: { progress: 1 } });
        await expect(command.func({ limit: 1, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC', message: expect.stringContaining(message),
        });
    });

    it('preserves explicitly nullable duration, progress, and playedAt fields', async () => {
        mockRequestJson
            .mockResolvedValueOnce(rootPage([historyRow('a', { duration: null })], null, { history: 1 }))
            .mockResolvedValueOnce({ data: [progressRow('a', { progress: null, playedAt: null })], credentials: { progress: 1 } });
        const [row] = await command.func({ limit: 1, all: false, 'max-pages': 10 });
        expect(row).toMatchObject({ durationSec: null, progressSec: null, progressPct: null, playedAt: null });
    });

    it('distinguishes a valid empty history from malformed payloads', async () => {
        mockRequestJson.mockResolvedValueOnce(rootPage([], null));
        await expect(command.func({ limit: 20, all: false, 'max-pages': 10 })).rejects.toMatchObject({
            code: 'EMPTY_RESULT',
        });
    });
});
