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

await import('./podcast-episodes.js');

let cmd;

beforeAll(() => {
    cmd = getRegistry().get('xiaoyuzhou/podcast-episodes');
    expect(cmd?.func).toBeTypeOf('function');
});

describe('xiaoyuzhou podcast-episodes', () => {
    beforeEach(() => {
        mockRequestJson.mockReset();
        mockLoadCredentials.mockReset();
        mockLoadCredentials.mockReturnValue({ access_token: 'access', refresh_token: 'refresh' });
    });

    it('calls the fixed episode list endpoint with desc ordering', async () => {
        mockRequestJson.mockResolvedValue({
            data: [
                {
                    eid: 'ep-1',
                    title: 'Episode 1',
                    duration: 3661,
                    playCount: 42,
                    pubDate: '2026-04-20T10:00:00.000Z',
                },
            ],
        });

        const result = await cmd.func({
            id: 'podcast-1',
            limit: 3,
        });

        expect(mockRequestJson).toHaveBeenCalledWith('/v1/episode/list', {
            method: 'POST',
            body: { pid: 'podcast-1', order: 'desc', limit: 3 },
            credentials: { access_token: 'access', refresh_token: 'refresh' },
        });
        expect(result).toEqual([
            {
                eid: 'ep-1',
                title: 'Episode 1',
                duration: '61:01',
                plays: 42,
                date: '2026-04-20',
            },
        ]);
    });

    it('rejects non-positive limits before hitting the API', async () => {
        await expect(cmd.func({
            id: 'podcast-1',
            limit: 0,
        })).rejects.toMatchObject({
            code: 'INVALID_ARGUMENT',
            message: 'limit must be a positive integer',
        });
        expect(mockRequestJson).not.toHaveBeenCalled();
    });
});
