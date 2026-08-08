import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

const { mockRequestJson, mockLoadCredentials } = vi.hoisted(() => ({
    mockRequestJson: vi.fn(),
    mockLoadCredentials: vi.fn(),
}));

vi.mock('./auth.js', async () => {
    const actual = await vi.importActual('./auth.js');
    return {
        ...actual,
        requestXiaoyuzhouJson: mockRequestJson,
        loadXiaoyuzhouCredentials: mockLoadCredentials,
    };
});

await import('./history.js');

let cmd;

beforeAll(() => {
    cmd = getRegistry().get('xiaoyuzhou/history');
    expect(cmd?.func).toBeTypeOf('function');
});

function episode(eid, overrides = {}) {
    return {
        eid,
        title: `Episode ${eid.slice(0, 2)}`,
        duration: 100,
        pubDate: '2026-08-01T00:00:00.000Z',
        isFinished: false,
        podcast: { title: 'Example Podcast' },
        ...overrides,
    };
}

describe('xiaoyuzhou history', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
        mockLoadCredentials.mockReset();
        mockLoadCredentials.mockReturnValue({ access_token: 'access', refresh_token: 'refresh' });
    });

    it('follows the top-level loadMoreKey and enriches rows with playback progress', async () => {
        const firstId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
        const secondId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
        const thirdId = 'cccccccccccccccccccccccc';
        mockRequestJson
            .mockResolvedValueOnce({
                data: [{ episode: episode(firstId) }, { episode: episode(secondId) }],
                raw: { loadMoreKey: 'cursor-page-2' },
                credentials: { access_token: 'page-1' },
            })
            .mockResolvedValueOnce({
                data: [{ episode: episode(thirdId, { isFinished: true }) }],
                raw: { loadMoreKey: null },
                credentials: { access_token: 'page-2' },
            })
            .mockResolvedValueOnce({
                data: [
                    { eid: firstId, progress: 25, playedAt: '2026-08-03T01:02:03.000Z' },
                    { eid: secondId, progress: 50, playedAt: '2026-08-02T01:02:03.000Z' },
                    { eid: thirdId, progress: 0, playedAt: '2026-08-01T01:02:03.000Z' },
                ],
                credentials: { access_token: 'progress' },
            });

        const result = await cmd.func({ limit: 3, all: false, 'max-pages': 500 });

        expect(mockRequestJson).toHaveBeenNthCalledWith(1, '/v1/episode-played/list-history', {
            method: 'POST',
            body: {},
            credentials: { access_token: 'access', refresh_token: 'refresh' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(2, '/v1/episode-played/list-history', {
            method: 'POST',
            body: { loadMoreKey: 'cursor-page-2' },
            credentials: { access_token: 'page-1' },
        });
        expect(mockRequestJson).toHaveBeenNthCalledWith(3, '/v1/playback-progress/list', {
            method: 'POST',
            body: { eids: [firstId, secondId, thirdId] },
            credentials: { access_token: 'page-2' },
        });
        expect(result).toHaveLength(3);
        expect(result[0]).toMatchObject({
            rank: 1,
            eid: firstId,
            progressSec: 25,
            progressPct: 25,
            playedAt: '2026-08-03T01:02:03.000Z',
            finished: false,
        });
        expect(result[2]).toMatchObject({
            eid: thirdId,
            progressSec: 0,
            progressPct: 0,
            finished: true,
        });
    });

    it('fetches every page with --all, deduplicates episodes, and batches progress requests', async () => {
        const firstPage = Array.from({ length: 50 }, (_, index) => episode(index.toString(16).padStart(24, '0')));
        const secondPage = [firstPage[49], episode('ffffffffffffffffffffffff')];
        mockRequestJson
            .mockResolvedValueOnce({ data: firstPage.map((item) => ({ episode: item })), raw: { loadMoreKey: 'next' }, credentials: { page: 1 } })
            .mockResolvedValueOnce({ data: secondPage.map((item) => ({ episode: item })), raw: {}, credentials: { page: 2 } })
            .mockResolvedValueOnce({ data: [], credentials: { batch: 1 } })
            .mockResolvedValueOnce({ data: [], credentials: { batch: 2 } });

        const result = await cmd.func({ limit: 999999, all: true, 'max-pages': 500 });

        expect(result).toHaveLength(51);
        expect(mockRequestJson).toHaveBeenCalledTimes(4);
        expect(mockRequestJson.mock.calls[2][1].body.eids).toHaveLength(50);
        expect(mockRequestJson.mock.calls[3][1].body.eids).toHaveLength(1);
        expect(result[0].playedAt).toBeNull();
    });

    it('rejects invalid pagination arguments before calling the API', async () => {
        await expect(cmd.func({ limit: 0, all: false, 'max-pages': 500 })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        await expect(cmd.func({ limit: 20, all: false, 'max-pages': 1001 })).rejects.toMatchObject({
            code: 'ARGUMENT',
        });
        expect(mockRequestJson).not.toHaveBeenCalled();
    });

    it('fails explicitly when pagination repeats a cursor', async () => {
        const onlyId = 'dddddddddddddddddddddddd';
        mockRequestJson
            .mockResolvedValueOnce({ data: [{ episode: episode(onlyId) }], raw: { loadMoreKey: 'same' }, credentials: { page: 1 } })
            .mockResolvedValueOnce({ data: [{ episode: episode(onlyId) }], raw: { loadMoreKey: 'same' }, credentials: { page: 2 } });

        await expect(cmd.func({ limit: 2, all: false, 'max-pages': 500 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'Xiaoyuzhou history pagination repeated the same cursor',
        });
    });

    it('fails instead of returning a partial --all archive at the page safety limit', async () => {
        mockRequestJson.mockResolvedValueOnce({
            data: [{ episode: episode('eeeeeeeeeeeeeeeeeeeeeeee') }],
            raw: { loadMoreKey: 'more' },
            credentials: { page: 1 },
        });

        await expect(cmd.func({ limit: 20, all: true, 'max-pages': 1 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('before reaching the end'),
        });
    });

    it('reports unexpected history and progress payloads as command errors', async () => {
        mockRequestJson.mockResolvedValueOnce({ data: { rows: [] }, raw: {}, credentials: {} });
        await expect(cmd.func({ limit: 20, all: false, 'max-pages': 500 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'Xiaoyuzhou history returned an unexpected response shape',
        });

        mockRequestJson
            .mockResolvedValueOnce({ data: [{ episode: episode('abababababababababababab') }], raw: {}, credentials: {} })
            .mockResolvedValueOnce({ data: { rows: [] }, credentials: {} });
        await expect(cmd.func({ limit: 20, all: false, 'max-pages': 500 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: 'Xiaoyuzhou playback progress returned an unexpected response shape',
        });
    });

    it('preserves missing numeric values as null instead of coercing them to zero', async () => {
        const eid = 'cdcdcdcdcdcdcdcdcdcdcdcd';
        mockRequestJson
            .mockResolvedValueOnce({
                data: [{ episode: episode(eid, { duration: null }) }],
                raw: {},
                credentials: {},
            })
            .mockResolvedValueOnce({
                data: [{ eid, progress: null, playedAt: null }],
                credentials: {},
            });

        const [result] = await cmd.func({ limit: 20, all: false, 'max-pages': 500 });
        expect(result).toMatchObject({
            durationSec: null,
            progressSec: null,
            progressPct: null,
            playedAt: null,
        });
    });
});
