import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './latest.js';
import './historical.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('frankfurter latest', () => {
    const cmd = getRegistry().get('frankfurter/latest');

    it('rejects bad base', async () => {
        await expect(cmd.func({ base: 'us' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 422 to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('{}', { status: 422 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes rate rows + carries date', async () => {
        const sample = { amount: 1, base: 'EUR', date: '2026-05-05', rates: { USD: 1.08, JPY: 165.5, GBP: 0.86 } };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ base: 'EUR', symbols: 'USD,JPY,GBP' });
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ rank: 1, base: 'EUR', target: 'USD', rate: 1.08, date: '2026-05-05' });
        expect(rows[2].target).toBe('GBP');
    });
});

describe('frankfurter historical', () => {
    const cmd = getRegistry().get('frankfurter/historical');

    it('rejects bad date format', async () => {
        await expect(cmd.func({ date: '2026/05/05' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --to before <date>', async () => {
        await expect(cmd.func({ date: '2026-05-05', to: '2026-05-01' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a single-day historical row', async () => {
        const sample = { amount: 1, base: 'EUR', date: '2026-05-01', rates: { USD: 1.07 } };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ date: '2026-05-01', base: 'EUR' });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toEqual({ rank: 1, date: '2026-05-01', base: 'EUR', target: 'USD', rate: 1.07 });
    });

    it('flattens range response newest-first', async () => {
        const sample = {
            amount: 1, base: 'EUR', start_date: '2026-05-01', end_date: '2026-05-03',
            rates: {
                '2026-05-01': { USD: 1.07 },
                '2026-05-02': { USD: 1.075 },
                '2026-05-03': { USD: 1.08 },
            },
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ date: '2026-05-01', to: '2026-05-03', base: 'EUR' });
        expect(rows).toHaveLength(3);
        expect(rows[0].date).toBe('2026-05-03');
        expect(rows[2].date).toBe('2026-05-01');
    });
});
