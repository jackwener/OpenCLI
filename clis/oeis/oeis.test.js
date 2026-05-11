import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './sequence.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('oeis search adapter', () => {
    const cmd = getRegistry().get('oeis/search');

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        // Fresh Response per call so we don't tickle "Body has already been read" between pages.
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('throttled', { status: 429 }))));
        await expect(cmd.func({ query: 'fibonacci', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when first page is empty', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 }))));
        await expect(cmd.func({ query: 'no-results', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips A-id from search row into oeis.org URL', async () => {
        const result = [{
            number: 45, name: 'Fibonacci numbers', keyword: 'core,nonn,nice',
            data: '0,1,1,2,3,5,8,13,21,34,55,89',
            author: 'Sloane', created: '1991-04-30T03:00:00-04:00',
        }];
        vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(result), { status: 200 }))));
        const rows = await cmd.func({ query: 'fibonacci', limit: 1 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 'A000045', name: 'Fibonacci numbers',
            keywords: 'core,nonn,nice',
            preview: '0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89',
            url: 'https://oeis.org/A000045',
        });
    });
});

describe('oeis sequence adapter', () => {
    const cmd = getRegistry().get('oeis/sequence');

    it('rejects malformed sequence ids before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ id: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'B000045' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'A' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws EmptyResultError when search returns null/empty list', async () => {
        // OEIS returns empty list (or sometimes null body) for unknown id.
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({ id: 'A9999999' })).rejects.toThrow(EmptyResultError);
    });

    it('counts comments / formulas / xrefs without dumping the full graph', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([{
            number: 40, name: 'The prime numbers.', keyword: 'core,nonn',
            data: '2,3,5,7,11,13,17,19,23',
            offset: '1,1', author: 'Sloane', created: '1991-04-30T03:00:00-04:00', revision: 100,
            comment: ['c1', 'c2', 'c3'],
            formula: ['f1', 'f2'],
            reference: ['r1'],
            xref: ['A000001', 'A000002'],
            link: ['l1', 'l2', 'l3', 'l4'],
        }]), { status: 200 })));
        const rows = await cmd.func({ id: 'A000040' });
        expect(rows[0]).toMatchObject({
            id: 'A000040', name: 'The prime numbers.',
            termCount: 9, offset: '1,1', revision: 100,
            commentCount: 3, formulaCount: 2, referenceCount: 1, xrefCount: 2, linkCount: 4,
            url: 'https://oeis.org/A000040',
        });
    });
});
