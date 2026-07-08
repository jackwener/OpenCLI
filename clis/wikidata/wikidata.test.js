import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './entity.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('wikidata search adapter', () => {
    const cmd = getRegistry().get('wikidata/search');

    it('rejects bad args before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ query: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 999 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', language: '!!' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('throttled', { status: 429 })));
        await expect(cmd.func({ query: 'einstein', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError on empty search list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ search: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'no-such-thing', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips Q-id from search row into wikidata.org URL', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            search: [{ id: 'Q937', label: 'Albert Einstein', description: 'physicist', match: { type: 'alias', text: 'Einstein' } }],
        }), { status: 200 })));
        const rows = await cmd.func({ query: 'einstein', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, qid: 'Q937', label: 'Albert Einstein', matchType: 'alias',
            url: 'https://www.wikidata.org/wiki/Q937',
        });
    });
});

describe('wikidata entity adapter', () => {
    const cmd = getRegistry().get('wikidata/entity');

    it('rejects malformed entity ids before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(cmd.func({ id: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'not-a-qid' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'Q' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
        await expect(cmd.func({ id: 'Q9999999999' })).rejects.toThrow(EmptyResultError);
    });

    it('falls back to English label when requested language is missing', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            entities: {
                Q937: {
                    id: 'Q937', type: 'item', modified: '2026-01-01T00:00:00Z',
                    labels: { en: { value: 'Albert Einstein', language: 'en' } },
                    descriptions: { en: { value: 'physicist', language: 'en' } },
                    aliases: { en: [{ value: 'A. Einstein', language: 'en' }] },
                    claims: { P31: [], P21: [] },
                    sitelinks: { enwiki: { title: 'Albert Einstein', site: 'enwiki' } },
                },
            },
        }), { status: 200 })));
        const rows = await cmd.func({ id: 'Q937', language: 'qq' });
        expect(rows[0]).toMatchObject({
            qid: 'Q937', label: 'Albert Einstein', description: 'physicist',
            aliases: 'A. Einstein', claimPropertyCount: 2, sitelinkCount: 1,
            enwikiTitle: 'Albert Einstein', url: 'https://www.wikidata.org/wiki/Q937',
        });
    });
});
