import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './show.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('tvmaze search adapter', () => {
    const cmd = getRegistry().get('tvmaze/search');

    it('rejects empty query and bad limit before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ query: '', limit: 5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ query: 'foo', limit: 100 })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 429 to CommandExecutionError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({ query: 'foo', limit: 5 })).rejects.toThrow(CommandExecutionError);
    });

    it('throws EmptyResultError when no shows match', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
        await expect(cmd.func({ query: 'asdfghjkl', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('strips HTML from summary and ids round-trip into tvmaze show <id>', async () => {
        const list = [{
            score: 1.2,
            show: {
                id: 169, name: 'Breaking Bad', type: 'Scripted', language: 'English',
                genres: ['Drama'], status: 'Ended', premiered: '2008-01-20', ended: '2019-10-11',
                network: { name: 'AMC' }, rating: { average: 9.2 },
                summary: '<p><b>Breaking Bad</b> is a show with &amp; entities &#39;here&#39;, &#x27;hex&#x27;, and &hellip;.</p>',
                url: 'https://www.tvmaze.com/shows/169/breaking-bad',
            },
        }];
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(list), { status: 200 })));

        const rows = await cmd.func({ query: 'breaking bad', limit: 5 });
        expect(rows[0]).toMatchObject({
            rank: 1, id: 169, name: 'Breaking Bad', network: 'AMC', rating: 9.2, matchScore: 1.2,
        });
        expect(rows[0].summary).toBe("Breaking Bad is a show with & entities 'here', 'hex', and ….");
        // id round-trip
        expect(typeof rows[0].id).toBe('number');
    });
});

describe('tvmaze show adapter', () => {
    const cmd = getRegistry().get('tvmaze/show');

    it('rejects non-positive id before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: 0 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: -5 })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ id: 'abc' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ id: 99999999 })).rejects.toThrow(EmptyResultError);
    });

    it('returns full show detail with externals + schedule', async () => {
        const show = {
            id: 169, name: 'Breaking Bad', type: 'Scripted', language: 'English', genres: ['Drama'],
            status: 'Ended', premiered: '2008-01-20', ended: '2019-10-11', runtime: 60, averageRuntime: 60,
            network: { name: 'AMC', country: { name: 'United States' } }, schedule: { time: '22:00', days: ['Sunday'] },
            rating: { average: 9.2 }, externals: { imdb: 'tt0903747', thetvdb: 81189 },
            officialSite: 'http://www.amc.com/shows/breaking-bad',
            summary: '<p>Plain.</p>', url: 'https://www.tvmaze.com/shows/169/breaking-bad',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(show), { status: 200 })));

        const rows = await cmd.func({ id: 169 });
        expect(rows[0]).toMatchObject({
            id: 169, name: 'Breaking Bad', country: 'United States', schedule: 'Sunday 22:00',
            imdb: 'tt0903747', thetvdb: 81189, rating: 9.2, summary: 'Plain.',
        });
    });
});
