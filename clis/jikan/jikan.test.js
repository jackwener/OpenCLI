import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './anime.js';
import './manga.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('jikan anime', () => {
    const cmd = getRegistry().get('jikan/anime');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --limit > 25', async () => {
        await expect(cmd.func({ query: 'cowboy', limit: 100 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty data array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'zzznomatch' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes an anime row with genres + studios + score', async () => {
        const sample = {
            data: [{
                mal_id: 1, title: 'Cowboy Bebop', title_english: 'Cowboy Bebop', title_japanese: 'カウボーイビバップ',
                type: 'TV', episodes: 26, status: 'Finished Airing',
                aired: { string: 'Apr 3, 1998 to Apr 24, 1999' },
                duration: '24 min per ep', rating: 'R - 17+ (violence & profanity)',
                score: 8.75, scored_by: 990000, rank: 42, popularity: 39,
                genres: [{ name: 'Action' }, { name: 'Drama' }, { name: 'Sci-Fi' }],
                studios: [{ name: 'Sunrise' }],
                url: 'https://myanimelist.net/anime/1/Cowboy_Bebop',
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ query: 'cowboy bebop' });
        expect(rows[0].malId).toBe(1);
        expect(rows[0].score).toBe(8.75);
        expect(rows[0].genres).toBe('Action, Drama, Sci-Fi');
        expect(rows[0].studios).toBe('Sunrise');
        expect(rows[0].episodes).toBe(26);
    });
});

describe('jikan manga', () => {
    const cmd = getRegistry().get('jikan/manga');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a manga row with chapters/volumes/authors', async () => {
        const sample = {
            data: [{
                mal_id: 2, title: 'Berserk', title_english: 'Berserk', title_japanese: 'ベルセルク',
                type: 'Manga', chapters: null, volumes: 42, status: 'Publishing',
                published: { string: 'Aug 25, 1989 to ?' },
                score: 9.47, scored_by: 350000, rank: 1, popularity: 4,
                genres: [{ name: 'Action' }, { name: 'Drama' }],
                authors: [{ name: 'Miura, Kentarou' }],
                url: 'https://myanimelist.net/manga/2/Berserk',
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ query: 'berserk' });
        expect(rows[0].malId).toBe(2);
        expect(rows[0].volumes).toBe(42);
        expect(rows[0].chapters).toBeNull();
        expect(rows[0].authors).toBe('Miura, Kentarou');
    });
});
