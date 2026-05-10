import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './user.js';
import './top.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('lichess user adapter', () => {
    const cmd = getRegistry().get('lichess/user');

    it('rejects bad usernames before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ username: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ username: 'a' })).rejects.toThrow(ArgumentError); // too short
        await expect(cmd.func({ username: 'has space' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ username: 'somebody' })).rejects.toThrow(CommandExecutionError);
    });

    it('treats disabled accounts as EmptyResultError (not row of nulls)', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: 'closed-user', username: 'ClosedUser', disabled: true,
        }), { status: 200 })));
        await expect(cmd.func({ username: 'ClosedUser' })).rejects.toThrow(EmptyResultError);
    });

    it('picks the most-played perf as topPerf', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            id: 'someplayer',
            username: 'SomePlayer',
            createdAt: 1543000000000,
            seenAt: 1700000000000,
            count: { all: 100, win: 50, loss: 30, draw: 20 },
            perfs: {
                bullet: { games: 9000, rating: 2700 },
                blitz: { games: 100, rating: 2200 },
                puzzle: { games: 99999, rating: 2900 }, // ignored — not playable
            },
        }), { status: 200 })));
        const rows = await cmd.func({ username: 'SomePlayer' });
        expect(rows[0]).toMatchObject({
            username: 'SomePlayer', id: 'someplayer',
            gamesAll: 100, topPerfName: 'bullet', topPerfRating: 2700, topPerfGames: 9000,
            url: 'https://lichess.org/@/SomePlayer',
        });
    });
});

describe('lichess top adapter', () => {
    const cmd = getRegistry().get('lichess/top');

    it('rejects unknown perf types before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ perf: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ perf: 'turbo' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ perf: 'blitz', limit: 9999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError on empty leaderboard', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ users: [] }), { status: 200 })));
        await expect(cmd.func({ perf: 'blitz', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips username from leaderboard into perf-specific URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            users: [{ id: 'magnus', username: 'Magnus', title: 'GM', perfs: { blitz: { rating: 3001, progress: 7 } } }],
        }), { status: 200 })));
        const rows = await cmd.func({ perf: 'blitz', limit: 3 });
        expect(rows[0]).toMatchObject({
            rank: 1, username: 'Magnus', title: 'GM', rating: 3001, progress: 7,
            url: 'https://lichess.org/@/Magnus/perf/blitz',
        });
    });
});
