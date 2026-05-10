import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './product.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('endoflife product adapter', () => {
    const cmd = getRegistry().get('endoflife/product');

    it('rejects empty / malformed product before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ product: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ product: 'BAD/PRODUCT' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ product: 'nodejs' })).rejects.toThrow(CommandExecutionError);
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ product: 'no-such-product' })).rejects.toThrow(EmptyResultError);
    });

    it('normalises lts/support/eol booleans + dates and projects eolStatus', async () => {
        const cycles = [
            { cycle: '24', releaseDate: '2025-05-06', latest: '24.15.0', latestReleaseDate: '2026-04-15', lts: '2025-10-28', support: '2026-10-20', eol: '2028-04-30', extendedSupport: false },
            { cycle: '20', releaseDate: '2023-04-18', latest: '20.20.2', latestReleaseDate: '2026-03-24', lts: '2023-10-24', support: '2024-10-22', eol: '2026-04-30', extendedSupport: true },
            { cycle: 'rolling', releaseDate: '2020-01-01', latest: 'next', latestReleaseDate: '2026-01-01', lts: false, support: true, eol: false, extendedSupport: false },
        ];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(cycles), { status: 200 })));

        const rows = await cmd.func({ product: 'nodejs' });
        expect(rows).toHaveLength(3);
        // Future eol -> active
        expect(rows[0]).toMatchObject({ product: 'nodejs', cycle: '24', eol: '2028-04-30', eolStatus: 'active' });
        expect(rows[1]).toMatchObject({ cycle: '20', eol: '2026-04-30', eolStatus: 'eol' });
        // Boolean true -> "ongoing"; boolean false -> null
        expect(rows[2]).toMatchObject({ cycle: 'rolling', lts: null, support: 'ongoing', eol: null, eolStatus: null });
        // Round-trip: product is the slug into endoflife.date URLs
        expect(rows[0].url).toBe('https://endoflife.date/nodejs');
    });
});
