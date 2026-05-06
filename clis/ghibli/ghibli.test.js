import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './films.js';
import './people.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleFilm = {
    id: '2baf70d1-42bb-4437-b551-e5fed5a87abe',
    title: 'Castle in the Sky',
    original_title: '天空の城ラピュタ',
    original_title_romanised: 'Tenkū no shiro Rapyuta',
    description: 'The orphan Sheeta inherited a mysterious crystal...',
    director: 'Hayao Miyazaki',
    producer: 'Isao Takahata',
    release_date: '1986',
    running_time: '124',
    rt_score: '95',
    image: 'https://image.tmdb.org/t/p/w600/...',
    movie_banner: 'https://image.tmdb.org/t/p/w1280/...',
    url: 'https://ghibliapi.vercel.app/films/2baf70d1-42bb-4437-b551-e5fed5a87abe',
};

const samplePerson = {
    id: '267649ac-fb1b-11eb-9a03-0242ac130003',
    name: 'Haku',
    gender: 'Male',
    age: '12',
    eye_color: 'Green',
    hair_color: 'Green',
    films: ['https://ghibliapi.vercel.app/films/dc2e6bd1-8156-4886-adff-b39e6043af0c'],
    species: 'https://ghibliapi.vercel.app/species/af3910a6-429f-4c74-9ad5-dfe1c4aa04f2',
    url: 'https://ghibliapi.vercel.app/people/267649ac-fb1b-11eb-9a03-0242ac130003',
};

describe('ghibli films', () => {
    const cmd = getRegistry().get('ghibli/films');

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

    it('shapes film rows + sorts ascending by release date', async () => {
        const newer = { ...sampleFilm, id: 'newer', release_date: '2001', title: 'Spirited Away' };
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify([newer, sampleFilm]),
            { status: 200 },
        )));
        const rows = await cmd.func({});
        expect(rows[0].id).toBe('2baf70d1-42bb-4437-b551-e5fed5a87abe'); // 1986
        expect(rows[1].id).toBe('newer');                                 // 2001
        expect(rows[0].rtScore).toBe('95');
    });
});

describe('ghibli people', () => {
    const cmd = getRegistry().get('ghibli/people');

    it('extracts speciesId from URL + counts films', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([samplePerson]), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0]).toMatchObject({
            id: '267649ac-fb1b-11eb-9a03-0242ac130003',
            name: 'Haku',
            speciesId: 'af3910a6-429f-4c74-9ad5-dfe1c4aa04f2',
            filmsCount: 1,
        });
    });

    it('preserves null for empty string gender / age', async () => {
        const partial = { ...samplePerson, gender: '', age: '' };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([partial]), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0].gender).toBeNull();
        expect(rows[0].age).toBeNull();
    });
});
