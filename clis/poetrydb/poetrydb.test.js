import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './random.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('poetrydb search', () => {
    const cmd = getRegistry().get('poetrydb/search');

    it('rejects calls with neither --author nor --title', async () => {
        await expect(cmd.func({})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects --limit > 200', async () => {
        await expect(cmd.func({ author: 'shakespeare', limit: 5000 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 404-wrapped not-found body to EmptyResultError', async () => {
        const body = { status: 404, reason: 'Not found' };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
        await expect(cmd.func({ author: 'nobody' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a poem row with line counts and joined text', async () => {
        const sample = [{
            title: 'Sonnet 18',
            author: 'William Shakespeare',
            linecount: '14',
            lines: ['Shall I compare thee to a summer\'s day?', 'Thou art more lovely and more temperate:', '...', 'So long lives this, and this gives life to thee.'],
        }];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ author: 'Shakespeare' });
        expect(rows[0].title).toBe('Sonnet 18');
        expect(rows[0].lineCount).toBe(14);
        expect(rows[0].firstLine).toMatch(/Shall I compare/);
        expect(rows[0].text.split('\n').length).toBe(4);
    });
});

describe('poetrydb random', () => {
    const cmd = getRegistry().get('poetrydb/random');

    it('rejects --count > 50', async () => {
        await expect(cmd.func({ count: 999 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('returns N rows for N random', async () => {
        const sample = [
            { title: 'A', author: 'Author A', linecount: '2', lines: ['a1', 'a2'] },
            { title: 'B', author: 'Author B', linecount: '2', lines: ['b1', 'b2'] },
        ];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ count: 2 });
        expect(rows).toHaveLength(2);
        expect(rows[0].rank).toBe(1);
        expect(rows[1].rank).toBe(2);
    });
});
