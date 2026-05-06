import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './books.js';
import './characters.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleBook = {
    url: 'https://anapioficeandfire.com/api/books/1',
    name: 'A Game of Thrones',
    isbn: '978-0553103540',
    authors: ['George R. R. Martin'],
    numberOfPages: 694,
    publisher: 'Bantam Books',
    country: 'United States',
    mediaType: 'Hardcover',
    released: '1996-08-01T00:00:00',
    characters: ['https://anapioficeandfire.com/api/characters/2', 'https://anapioficeandfire.com/api/characters/12'],
    povCharacters: ['https://anapioficeandfire.com/api/characters/148'],
};

const sampleCharacter = {
    url: 'https://anapioficeandfire.com/api/characters/96',
    name: 'Alys Karstark',
    gender: 'Female',
    culture: 'Northmen',
    born: 'In 284 AC or 285 AC',
    died: '',
    titles: [''],
    aliases: [],
    allegiances: ['https://anapioficeandfire.com/api/houses/215'],
    books: ['https://anapioficeandfire.com/api/books/8'],
    tvSeries: ['Season 6'],
};

describe('iceandfire books', () => {
    const cmd = getRegistry().get('iceandfire/books');

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

    it('extracts id from url + joins authors + counts characters', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([sampleBook]), { status: 200 })));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0]).toMatchObject({
            id: '1',
            name: 'A Game of Thrones',
            authors: 'George R. R. Martin',
            charactersCount: 2,
            povCharactersCount: 1,
        });
    });
});

describe('iceandfire characters', () => {
    const cmd = getRegistry().get('iceandfire/characters');

    it('preserves null (not empty string) for empty died/aliases', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([sampleCharacter]), { status: 200 })));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0].died).toBeNull();    // sample.died is '' — must NOT round-trip as ''
        expect(rows[0].aliases).toBeNull(); // sample.aliases is [] — must NOT round-trip as ''
        expect(rows[0].titles).toBeNull();  // sample.titles is [''] — filter(Boolean) drops empty → []
    });

    it('threads --culture filter to query string', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify([sampleCharacter]), { status: 200 }));
        });
        await cmd.func({ limit: 1, culture: 'Northmen' });
        expect(calls[0]).toContain('culture=Northmen');
    });

    it('extracts id from url', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([sampleCharacter]), { status: 200 })));
        const rows = await cmd.func({ limit: 1 });
        expect(rows[0].id).toBe('96');
    });
});
