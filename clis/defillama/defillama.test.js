import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './protocols.js';
import './protocol.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('defillama protocols adapter', () => {
    const cmd = getRegistry().get('defillama/protocols');

    it('rejects bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ limit: 1000 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when API returns no protocols', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({ limit: 5 })).rejects.toThrow(EmptyResultError);
    });

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

describe('defillama protocol adapter', () => {
    const cmd = getRegistry().get('defillama/protocol');

    it('rejects empty / malformed slug before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ slug: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ slug: 'BAD SLUG' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 400 "Protocol not found" to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Protocol not found', { status: 400 })));
        await expect(cmd.func({ slug: 'no-such-thing' })).rejects.toThrow(EmptyResultError);
    });

    it('parent protocols aggregate chains from children in /protocols', async () => {
        const detail = {
            id: 'parent#aave',
            name: 'Aave',
            isParentProtocol: true,
            chains: [],
            tvl: [{ date: 1700000000, totalLiquidityUSD: 12345 }],
            mcap: 1e9,
            twitter: 'aave',
            github: ['aave'],
            description: 'lending',
            url: 'https://aave.com',
        };
        const list = [
            { name: 'Aave V3', slug: 'aave-v3', parentProtocol: 'parent#aave', chains: ['Ethereum', 'Polygon'], category: 'Lending' },
            { name: 'Aave V2', slug: 'aave-v2', parentProtocol: 'parent#aave', chains: ['Ethereum'], category: 'Lending' },
            { name: 'Other', slug: 'other', chains: ['Solana'] },
        ];
        const fetchMock = vi.fn()
            .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(detail), { status: 200 })))
            .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify(list), { status: 200 })));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ slug: 'aave' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            slug: 'aave', name: 'Aave', isParent: true, tvl: 12345, tvlAt: '2023-11-14',
        });
        // chains should include Ethereum + Polygon (children) but not Solana (unrelated)
        expect(rows[0].chains.split(', ').sort()).toEqual(['Ethereum', 'Polygon']);
    });
});
