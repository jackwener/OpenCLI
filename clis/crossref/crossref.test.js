import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './works.js';
import './work.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('crossref works adapter', () => {
    const cmd = getRegistry().get('crossref/works');

    it('rejects empty / oversized queries before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ query: 'whatever', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty items list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            status: 'ok', message: { items: [] },
        }), { status: 200 })));
        await expect(cmd.func({ query: 'no-matches', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips DOI shape into doi.org URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            status: 'ok',
            message: {
                items: [{
                    DOI: '10.1038/nature12373',
                    title: ['Nanometre-scale thermometry in a living cell'],
                    author: [{ given: 'G.', family: 'Kucsko' }],
                    publisher: 'Nature',
                    type: 'journal-article',
                    'is-referenced-by-count': 1763,
                    issued: { 'date-parts': [[2013, 8]] },
                }],
            },
        }), { status: 200 })));

        const rows = await cmd.func({ query: 'thermometry', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1,
            doi: '10.1038/nature12373',
            title: 'Nanometre-scale thermometry in a living cell',
            authors: 'G. Kucsko',
            published: '2013-08',
            citations: 1763,
            url: 'https://doi.org/10.1038/nature12373',
        });
    });
});

describe('crossref work adapter', () => {
    const cmd = getRegistry().get('crossref/work');

    it('rejects malformed DOI before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ doi: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ doi: 'not-a-doi' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ doi: 'doi:malformed/' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ doi: '10.0000/missing' })).rejects.toThrow(EmptyResultError);
    });

    it('strips DOI URL prefixes from input', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            status: 'ok',
            message: {
                DOI: '10.1038/nature12373',
                title: ['T'],
                author: [],
                publisher: 'Nature',
                type: 'journal-article',
                issued: { 'date-parts': [[2013, 8, 1]] },
            },
        }), { status: 200 })));

        const rows = await cmd.func({ doi: 'https://doi.org/10.1038/nature12373' });
        expect(rows[0]).toMatchObject({
            doi: '10.1038/nature12373',
            published: '2013-08-01',
            url: 'https://doi.org/10.1038/nature12373',
        });
    });
});
