import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './greeks.js';

const { normalizeExpiration, normalizeSymbol, parseLimit, unwrapBrowserResult } = await import('./greeks.js').then((m) => m.__test__);

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('barchart greeks command', () => {
    const command = getRegistry().get('barchart/greeks');

    it('registers with the expected shape', () => {
        expect(command).toBeDefined();
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.columns).toEqual([
            'type', 'strike', 'last', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho',
            'volume', 'openInterest', 'expiration',
        ]);
    });

    it('maps returned option rows without changing the declared output shape', async () => {
        const page = makePage({
            session: 'site:barchart',
            data: {
            ok: true,
            rows: [
                {
                    type: 'Call',
                    strike: 190,
                    last: 3.456,
                    iv: 21.234,
                    delta: 0.56789,
                    gamma: 0.01234,
                    theta: -0.12345,
                    vega: 0.23456,
                    rho: 0.03456,
                    volume: 123,
                    openInterest: 456,
                    expiration: '2026-06-19',
                },
            ],
            },
        });

        const rows = await command.func(page, { symbol: 'aapl', limit: 1 });

        expect(page.goto).toHaveBeenCalledWith('https://www.barchart.com/stocks/quotes/AAPL/options');
        expect(page.wait).toHaveBeenCalledWith(4);
        expect(rows).toEqual([
            {
                type: 'Call',
                strike: 190,
                last: 3.46,
                iv: '21.23%',
                delta: 0.5679,
                gamma: 0.0123,
                theta: -0.1235,
                vega: 0.2346,
                rho: 0.0346,
                volume: 123,
                openInterest: 456,
                expiration: '2026-06-19',
            },
        ]);
    });

    it('validates args before browser navigation and unwraps bridge envelopes', async () => {
        expect(normalizeSymbol(' aapl ')).toBe('AAPL');
        expect(normalizeExpiration('2026-06-19')).toBe('2026-06-19');
        expect(parseLimit(undefined)).toBe(10);
        expect(parseLimit(100)).toBe(100);
        expect(unwrapBrowserResult({ session: 'site:barchart', data: { ok: true } })).toEqual({ ok: true });

        await expect(command.func(makePage({ ok: true, rows: [] }), { symbol: '', limit: 1 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(makePage({ ok: true, rows: [] }), { symbol: 'AAPL', expiration: '2026-02-30', limit: 1 }))
            .rejects.toBeInstanceOf(ArgumentError);
        await expect(command.func(makePage({ ok: true, rows: [] }), { symbol: 'AAPL', limit: 101 }))
            .rejects.toBeInstanceOf(ArgumentError);
    });

    it('embeds expiration and limit in the browser-side request script', async () => {
        const page = makePage({
            ok: true,
            rows: [{
                type: 'Put',
                strike: 185,
                last: null,
                iv: null,
                delta: null,
                gamma: null,
                theta: null,
                vega: null,
                rho: null,
                volume: 0,
                openInterest: 0,
                expiration: '2026-07-17',
            }],
        });

        await command.func(page, { symbol: 'MSFT', expiration: '2026-07-17', limit: 7 });
        const script = page.evaluate.mock.calls[0][0];

        expect(script).toContain('const expDate = "2026-07-17"');
        expect(script).toContain('const limit = 7');
        expect(script).toContain("url += '&expirationDate=' + encodeURIComponent(expDate)");
    });

    it('throws CommandExecutionError for HTTP, malformed, exception, and missing payload states', async () => {
        await expect(command.func(makePage({ ok: false, reason: 'http', status: 403, statusText: 'Forbidden' }), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: false, reason: 'malformed' }), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: false, reason: 'exception', message: 'network down' }), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: false, reason: 'malformed', message: 'options rows did not include call or put identities' }), { symbol: 'AAPL' }))
            .rejects.toThrow('call or put identities');
        await expect(command.func(makePage(null), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: true, rows: 'bad' }), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: true, rows: [{ type: 'Call', strike: null, expiration: '' }] }), { symbol: 'AAPL' }))
            .rejects.toThrow('malformed option row identity');
    });

    it('throws EmptyResultError when Barchart returns no greeks rows', async () => {
        await expect(command.func(makePage({ ok: true, rows: [] }), { symbol: 'AAPL' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
