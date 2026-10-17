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

describe('xiaoyuzhou history', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
        mockLoadCredentials.mockReset();
        mockLoadCredentials.mockReturnValue({ access_token: 'access', refresh_token: 'refresh' });
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

});
