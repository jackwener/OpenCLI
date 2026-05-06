import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './today.js';
import './range.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('nasa-apod today', () => {
    const cmd = getRegistry().get('nasa-apod/today');

    it('rejects malformed --date', async () => {
        await expect(cmd.func({ date: 'tomorrow' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects pre-launch date', async () => {
        await expect(cmd.func({ date: '1990-01-01' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes a today row', async () => {
        const sample = {
            date: '2026-05-06',
            title: 'A Galaxy Far, Far Away',
            explanation: 'Beautiful spiral.',
            media_type: 'image',
            url: 'https://apod.nasa.gov/apod/image/2605/x.jpg',
            hdurl: 'https://apod.nasa.gov/apod/image/2605/x_hd.jpg',
            copyright: 'NASA / JPL',
            service_version: 'v1',
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0].date).toBe('2026-05-06');
        expect(rows[0].mediaType).toBe('image');
        expect(rows[0].pageUrl).toBe('https://apod.nasa.gov/apod/ap260506.html');
    });
});

describe('nasa-apod range', () => {
    const cmd = getRegistry().get('nasa-apod/range');

    it('rejects missing start', async () => {
        await expect(cmd.func({})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects end < start', async () => {
        await expect(cmd.func({ start: '2026-05-05', end: '2026-05-01' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
        await expect(cmd.func({ start: '2026-05-05', end: '2026-05-05' })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('reverses NASA oldest-first to newest-first', async () => {
        const sample = [
            { date: '2026-05-04', title: 'Day 1', media_type: 'image', url: 'u1', hdurl: 'h1' },
            { date: '2026-05-05', title: 'Day 2', media_type: 'image', url: 'u2', hdurl: 'h2' },
            { date: '2026-05-06', title: 'Day 3', media_type: 'video', url: 'u3', hdurl: '' },
        ];
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({ start: '2026-05-04', end: '2026-05-06' });
        expect(rows[0].date).toBe('2026-05-06');
        expect(rows[2].date).toBe('2026-05-04');
        expect(rows[0].rank).toBe(1);
    });
});
