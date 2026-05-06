import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './character.js';
import './episode.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleCharacter = {
    id: 1,
    name: 'Rick Sanchez',
    status: 'Alive',
    species: 'Human',
    type: '',
    gender: 'Male',
    origin: { name: 'Earth (C-137)', url: 'https://rickandmortyapi.com/api/location/1' },
    location: { name: 'Citadel of Ricks', url: 'https://rickandmortyapi.com/api/location/3' },
    image: 'https://rickandmortyapi.com/api/character/avatar/1.jpeg',
    episode: ['https://rickandmortyapi.com/api/episode/1', 'https://rickandmortyapi.com/api/episode/2'],
    url: 'https://rickandmortyapi.com/api/character/1',
    created: '2017-11-04T18:48:46.250Z',
};

const sampleEpisode = {
    id: 1,
    name: 'Pilot',
    air_date: 'December 2, 2013',
    episode: 'S01E01',
    characters: ['https://rickandmortyapi.com/api/character/1', 'https://rickandmortyapi.com/api/character/2'],
    url: 'https://rickandmortyapi.com/api/episode/1',
    created: '2017-11-10T12:56:33.798Z',
};

describe('rickandmorty character', () => {
    const cmd = getRegistry().get('rickandmorty/character');

    it('rejects --limit out of range', async () => {
        await expect(cmd.func({ limit: 500 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404 (no-match) to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('not found', { status: 404 })));
        await expect(cmd.func({ name: 'nonsense-xyz' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('promotes 429 to CommandExecutionError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('preserves null (not empty string) for missing type', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ info: { next: null }, results: [sampleCharacter] }),
            { status: 200 },
        )));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0].type).toBeNull(); // sampleCharacter.type is '' — must NOT be coerced to ''
    });

    it('shapes rows with origin/location flattened to name', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ info: { next: null }, results: [sampleCharacter] }),
            { status: 200 },
        )));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0]).toMatchObject({
            id: 1,
            name: 'Rick Sanchez',
            origin: 'Earth (C-137)',
            location: 'Citadel of Ricks',
            episodes: 2,
        });
    });

    it('threads --name filter to query string', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(
                JSON.stringify({ info: { next: null }, results: [sampleCharacter] }),
                { status: 200 },
            ));
        });
        await cmd.func({ limit: 1, name: 'Rick' });
        expect(calls[0]).toContain('name=Rick');
    });
});

describe('rickandmorty episode', () => {
    const cmd = getRegistry().get('rickandmorty/episode');

    it('shapes episode rows with episodeCode + characters count', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ info: { next: null }, results: [sampleEpisode] }),
            { status: 200 },
        )));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0]).toMatchObject({
            id: 1,
            name: 'Pilot',
            episodeCode: 'S01E01',
            airDate: 'December 2, 2013',
            characters: 2,
        });
    });

    it('walks pagination via info.next', async () => {
        let call = 0;
        global.fetch = vi.fn(() => {
            call += 1;
            const next = call === 1 ? 'https://rickandmortyapi.com/api/episode/?page=2' : null;
            return Promise.resolve(new Response(
                JSON.stringify({ info: { next }, results: [{ ...sampleEpisode, id: call }] }),
                { status: 200 },
            ));
        });
        const rows = await cmd.func({ limit: 2 });
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.id)).toEqual([1, 2]);
    });
});
