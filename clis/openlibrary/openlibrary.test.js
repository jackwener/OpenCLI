import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './work.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('openlibrary search adapter', () => {
    const cmd = getRegistry().get('openlibrary/search');

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

    it('throws EmptyResultError on empty docs list', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ docs: [] }), { status: 200 })));
        await expect(cmd.func({ query: 'no-matches', limit: 5 })).rejects.toThrow(EmptyResultError);
    });

    it('round-trips work key into /works/<id> URL', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            docs: [{
                key: '/works/OL45804W',
                title: 'Fantastic Mr Fox',
                author_name: ['Roald Dahl'],
                first_publish_year: 1970,
                edition_count: 139,
                ebook_access: 'borrowable',
                language: ['eng', 'sco'],
                isbn: ['9780140328721', '0140328726'],
                subject: ['Foxes', 'Juvenile fiction'],
                cover_i: 6498519,
            }],
        }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const rows = await cmd.func({ query: 'mr fox', limit: 5 });
        const url = new URL(fetchMock.mock.calls[0][0]);
        expect(url.searchParams.get('fields')).toBe('key,title,author_name,first_publish_year,edition_count,ebook_access,language,isbn,subject,cover_i');
        expect(rows[0]).toMatchObject({
            rank: 1,
            workKey: 'OL45804W',
            title: 'Fantastic Mr Fox',
            language: 'eng, sco',
            isbn: '9780140328721, 0140328726',
            subjects: 'Foxes, Juvenile fiction',
            url: 'https://openlibrary.org/works/OL45804W',
        });
    });
});

describe('openlibrary work adapter', () => {
    const cmd = getRegistry().get('openlibrary/work');

    it('rejects malformed work keys before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ workKey: '' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ workKey: 'OL12M' })).rejects.toThrow(ArgumentError);
        await expect(cmd.func({ workKey: 'not-a-key' })).rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('maps HTTP 404 to EmptyResultError', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not found', { status: 404 })));
        await expect(cmd.func({ workKey: 'OL999999999W' })).rejects.toThrow(EmptyResultError);
    });

    it('flattens description object form to plain string + tolerates missing ratings', async () => {
        // Fetch is called twice: once for the work, once for ratings (404 here).
        const callTargets = [];
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url) => {
            callTargets.push(String(url));
            if (url.endsWith('/ratings.json')) {
                return new Response('{}', { status: 404 });
            }
            return new Response(JSON.stringify({
                title: 'Fantastic Mr Fox',
                description: { type: '/type/text', value: '  A fox steals food.  ' },
                subjects: ['Animals'],
                covers: [6498519],
                authors: [{ author: { key: '/authors/OL34184A' } }],
                first_publish_date: '1970',
            }), { status: 200 });
        }));

        const rows = await cmd.func({ workKey: 'OL45804W' });
        expect(rows[0]).toMatchObject({
            workKey: 'OL45804W',
            title: 'Fantastic Mr Fox',
            description: 'A fox steals food.',
            authors: 'OL34184A',
            rating: null,
            ratingsCount: null,
        });
        // Ratings 404 must not propagate; both URLs were attempted.
        expect(callTargets.some((u) => u.endsWith('/ratings.json'))).toBe(true);
    });
});
