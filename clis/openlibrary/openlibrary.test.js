import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './work.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('openlibrary search', () => {
    const cmd = getRegistry().get('openlibrary/search');

    it('rejects empty query', async () => {
        await expect(cmd.func({ query: '   ' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty docs to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ docs: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'xxxnomatch' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a search row + builds cover URL', async () => {
        const sample = {
            docs: [{
                key: '/works/OL45804W',
                title: 'Fantastic Mr. Fox',
                author_name: ['Roald Dahl'],
                first_publish_year: 1970,
                edition_count: 200,
                isbn: ['0140328726', '9780140328721'],
                subject: ['Children', 'Foxes', 'Farms'],
                language: ['eng'],
                cover_i: 8232153,
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ query: 'fox' });
        expect(rows[0].olid).toBe('OL45804W');
        expect(rows[0].coverUrl).toBe('https://covers.openlibrary.org/b/id/8232153-L.jpg');
        expect(rows[0].subjects).toBe('Children, Foxes, Farms');
        expect(rows[0].isbnCount).toBe(2);
    });
});

describe('openlibrary work', () => {
    const cmd = getRegistry().get('openlibrary/work');

    it('rejects garbage ref', async () => {
        await expect(cmd.func({ ref: 'not an olid' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a work row directly from OLID', async () => {
        const sample = {
            key: '/works/OL45804W',
            title: 'Fantastic Mr. Fox',
            first_publish_date: '1970',
            subjects: ['Children', 'Foxes'],
            subject_places: ['England'],
            subject_times: ['20th century'],
            description: { value: 'A clever fox steals food from three mean farmers.' },
            authors: [{ author: { key: '/authors/OL34184A' } }],
            covers: [8232153, 12345],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ ref: 'OL45804W' });
        expect(rows[0].title).toBe('Fantastic Mr. Fox');
        expect(rows[0].authorOlids).toBe('OL34184A');
        expect(rows[0].description).toBe('A clever fox steals food from three mean farmers.');
        expect(rows[0].coverUrl).toBe('https://covers.openlibrary.org/b/id/8232153-L.jpg');
    });

    it('resolves ISBN → edition → work via two fetches', async () => {
        const editionResp = { works: [{ key: '/works/OL45804W' }] };
        const workResp = {
            key: '/works/OL45804W',
            title: 'Fantastic Mr. Fox',
            first_publish_date: '1970',
            authors: [{ author: { key: '/authors/OL34184A' } }],
            covers: [8232153],
            description: 'A clever fox.',
        };
        let call = 0;
        global.fetch = vi.fn(() => {
            call += 1;
            if (call === 1) return Promise.resolve(new Response(JSON.stringify(editionResp), { status: 200 }));
            return Promise.resolve(new Response(JSON.stringify(workResp), { status: 200 }));
        });
        const rows = await cmd.func({ ref: '9780140328721' });
        expect(rows[0].olid).toBe('OL45804W');
        expect(call).toBe(2);
    });
});
