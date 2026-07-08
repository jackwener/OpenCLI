import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './coin.js';
import './trending.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('coingecko coin adapter', () => {
    const cmd = getRegistry().get('coingecko/coin');

    it('rejects invalid id and currency before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: '../btc', currency: 'usd' }))
            .rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'bitcoin', currency: '$$$' }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast when the requested currency has no market fields', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'bitcoin',
                symbol: 'btc',
                name: 'Bitcoin',
                market_data: {
                    current_price: { usd: 1 },
                    market_cap: { usd: 2 },
                    total_volume: { usd: 3 },
                },
            }), { status: 200 }),
        ));

        await expect(cmd.func({ id: 'bitcoin', currency: 'zzz' }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('returns selected currency market data', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({
                id: 'bitcoin',
                symbol: 'btc',
                name: 'Bitcoin',
                market_cap_rank: 1,
                genesis_date: '2009-01-03',
                links: { homepage: ['https://bitcoin.org', ''] },
                market_data: {
                    current_price: { cny: 7 },
                    market_cap: { cny: 8 },
                    total_volume: { cny: 9 },
                    price_change_percentage_24h: 1.23,
                    ath: { cny: 10 },
                    ath_date: { cny: '2024-01-02T00:00:00Z' },
                    atl: { cny: 1 },
                    atl_date: { cny: '2015-01-14T00:00:00Z' },
                    circulating_supply: 19,
                },
            }), { status: 200 }),
        ));

        const rows = await cmd.func({ id: 'bitcoin', currency: 'cny' });

        expect(rows).toEqual([expect.objectContaining({
            id: 'bitcoin',
            symbol: 'BTC',
            rank: 1,
            price: 7,
            marketCap: 8,
            volume24h: 9,
            athDate: '2024-01-02',
            homepage: 'https://bitcoin.org',
        })]);
    });

    it('maps 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
        ));

        await expect(cmd.func({ id: 'missing', currency: 'usd' }))
            .rejects.toThrow(EmptyResultError);
    });
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
