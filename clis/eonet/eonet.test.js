import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './events.js';
import './categories.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleEvent = {
    id: 'EONET_19972',
    title: 'Black Rush Lake RX Prescribed Fire, Swift, Minnesota',
    description: null,
    closed: null,
    categories: [{ id: 'wildfires', title: 'Wildfires' }],
    sources: [{ id: 'InciWeb' }, { id: 'IRWIN' }],
    geometry: [{ magnitudeValue: 100, magnitudeUnit: 'acres', date: '2026-04-15T12:00:00Z', type: 'Point', coordinates: [-95.7, 45.7] }],
    link: 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_19972',
};

const sampleCategory = {
    id: 'wildfires',
    title: 'Wildfires',
    description: 'Wildfires include all wildland fires.',
    link: 'https://eonet.gsfc.nasa.gov/api/v3/categories/wildfires',
};

describe('eonet events', () => {
    const cmd = getRegistry().get('eonet/events');

    it('rejects --limit out of range', async () => {
        await expect(cmd.func({ limit: 99999 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects invalid --status', async () => {
        await expect(cmd.func({ status: 'pending' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 429 to CommandExecutionError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('promotes empty events array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ events: [] }), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('preserves description=null and closed=null (not coerced to empty string)', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ events: [sampleEvent] }),
            { status: 200 },
        )));
        const rows = await cmd.func({});
        expect(rows[0].description).toBeNull();
        expect(rows[0].closed).toBeNull();
    });

    it('joins category titles + source ids with comma', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ events: [sampleEvent] }),
            { status: 200 },
        )));
        const rows = await cmd.func({});
        expect(rows[0].categories).toBe('Wildfires');
        expect(rows[0].sources).toBe('InciWeb, IRWIN');
        expect(rows[0].magnitudeValue).toBe(100);
        expect(rows[0].magnitudeUnit).toBe('acres');
    });
});

describe('eonet categories', () => {
    const cmd = getRegistry().get('eonet/categories');

    it('shapes category rows', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(
            JSON.stringify({ categories: [sampleCategory] }),
            { status: 200 },
        )));
        const rows = await cmd.func({});
        expect(rows[0]).toMatchObject({
            id: 'wildfires',
            title: 'Wildfires',
            link: 'https://eonet.gsfc.nasa.gov/api/v3/categories/wildfires',
        });
    });

    it('promotes empty categories to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ categories: [] }), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });
});
