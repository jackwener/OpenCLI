import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './user.js';
import './top.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('lichess top adapter', () => {
    const cmd = getRegistry().get('lichess/top');

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
