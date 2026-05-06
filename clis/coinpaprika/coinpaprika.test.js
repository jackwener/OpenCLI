import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './coins.js';
import './ticker.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleCoins = [
    { id: 'btc-bitcoin', name: 'Bitcoin', symbol: 'BTC', rank: 1, is_new: false, is_active: true, type: 'coin' },
    { id: 'eth-ethereum', name: 'Ethereum', symbol: 'ETH', rank: 2, is_new: false, is_active: true, type: 'coin' },
    { id: 'unranked-x', name: 'Unranked X', symbol: 'UNX', rank: 0, is_new: true, is_active: false, type: 'token' },
];

const sampleTicker = {
    id: 'btc-bitcoin',
    name: 'Bitcoin',
    symbol: 'BTC',
    rank: 1,
    total_supply: 20025434,
    max_supply: 21000000,
    circulating_supply: 19800000,
    first_data_at: '2010-07-17T00:00:00Z',
    last_updated: '2026-05-06T08:37:17Z',
    quotes: {
        USD: {
            price: 81781.7,
            volume_24h: 32144670153,
            market_cap: 1637713866824,
            percent_change_1h: 0.5,
            percent_change_24h: 1.4,
            percent_change_7d: -2.1,
        },
    },
};

describe('coinpaprika coins', () => {
    const cmd = getRegistry().get('coinpaprika/coins');

    it('rejects --limit out of range', async () => {
        await expect(cmd.func({ limit: 99999 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 429 to CommandExecutionError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('promotes empty array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('sorts unranked coins last (rank=0 → infinity)', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sampleCoins), { status: 200 })));
        const rows = await cmd.func({ limit: 5 });
        expect(rows[0].id).toBe('btc-bitcoin');
        expect(rows[1].id).toBe('eth-ethereum');
        expect(rows[2].id).toBe('unranked-x');
        expect(rows[2].coinRank).toBeNull(); // null preserved (not 0)
    });

    it('--active filters out delisted coins', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sampleCoins), { status: 200 })));
        const rows = await cmd.func({ active: true });
        expect(rows.map((r) => r.id)).toEqual(['btc-bitcoin', 'eth-ethereum']);
    });
});

describe('coinpaprika ticker', () => {
    const cmd = getRegistry().get('coinpaprika/ticker');

    it('rejects empty coin id', async () => {
        await expect(cmd.func({ coin: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 (unknown coin) to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('not found', { status: 404 })));
        await expect(cmd.func({ coin: 'nonsense-xyz' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes ticker row + flattens USD quote', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sampleTicker), { status: 200 })));
        const rows = await cmd.func({ coin: 'btc-bitcoin' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            id: 'btc-bitcoin',
            symbol: 'BTC',
            priceUsd: 81781.7,
            marketCapUsd: 1637713866824,
            percentChange24h: 1.4,
        });
    });

    it('lowercases coin id before URL building', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify(sampleTicker), { status: 200 }));
        });
        await cmd.func({ coin: 'BTC-BITCOIN' });
        expect(calls[0]).toContain('btc-bitcoin');
    });
});
