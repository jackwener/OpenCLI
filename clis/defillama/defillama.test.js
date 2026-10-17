import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './protocols.js';
import './protocol.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('defillama protocols adapter', () => {
    const cmd = getRegistry().get('defillama/protocols');

    it('returns rows whose slug round-trips into defillama protocol <slug>', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
            { name: 'Aave V3', slug: 'aave-v3', tvl: 1000, mcap: 500, category: 'Lending', chains: ['Ethereum', 'Polygon'], change_1d: 1, change_7d: 2, listedAt: 1668170565 },
            { name: 'Lido', slug: 'lido', tvl: 800, mcap: 200, category: 'Liquid Staking', chains: ['Ethereum'], change_1d: 0.5, change_7d: 1, listedAt: 1640000000 },
        ]), { status: 200 })));

        const rows = await cmd.func({ limit: 10 });
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            rank: 1, slug: 'aave-v3', name: 'Aave V3', category: 'Lending', tvl: 1000,
            chains: 'Ethereum, Polygon', url: 'https://defillama.com/protocol/aave-v3',
        });
        // slug is the round-trip key into defillama protocol
        expect(rows[0].slug).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    });
});
