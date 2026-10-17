import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './coin.js';
import './trending.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('coingecko trending adapter', () => {
    const cmd = getRegistry().get('coingecko/trending');

    it('returns ids that round-trip into coingecko coin <id>', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                coins: [{ item: { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', market_cap_rank: 1, price_btc: 1, thumb: 'thumb.png' } }],
            }), { status: 200 }),
        ));

        const rows = await cmd.func({});

        expect(rows).toEqual([expect.objectContaining({
            id: 'bitcoin',
            symbol: 'BTC',
            marketCapRank: 1,
        })]);
    });
});
