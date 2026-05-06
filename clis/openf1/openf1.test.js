import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError, CommandExecutionError } from '@jackwener/opencli/errors';
import './sessions.js';
import './drivers.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

const sampleSession = {
    session_key: 9472,
    session_type: 'Race',
    session_name: 'Race',
    date_start: '2024-03-02T15:00:00+00:00',
    date_end: '2024-03-02T17:00:00+00:00',
    meeting_key: 1229,
    circuit_short_name: 'Sakhir',
    country_code: 'BRN',
    country_name: 'Bahrain',
    location: 'Sakhir',
    gmt_offset: '03:00:00',
    year: 2024,
    is_cancelled: false,
};

const sampleDriver = {
    meeting_key: 1229,
    session_key: 9472,
    driver_number: 1,
    broadcast_name: 'M VERSTAPPEN',
    full_name: 'Max VERSTAPPEN',
    name_acronym: 'VER',
    team_name: 'Red Bull Racing',
    team_colour: '3671c6',
    first_name: 'Max',
    last_name: 'Verstappen',
    country_code: 'NED',
    headshot_url: 'https://media.formula1.com/...',
};

describe('openf1 sessions', () => {
    const cmd = getRegistry().get('openf1/sessions');

    it('rejects --limit out of range', async () => {
        await expect(cmd.func({ limit: 99999 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects non-positive year', async () => {
        await expect(cmd.func({ year: 0 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes 429 to CommandExecutionError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('rate limited', { status: 429 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('promotes empty array to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response('[]', { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes session rows', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([sampleSession]), { status: 200 })));
        const rows = await cmd.func({ year: 2024 });
        expect(rows[0]).toMatchObject({
            sessionKey: 9472,
            sessionType: 'Race',
            circuit: 'Sakhir',
            countryCode: 'BRN',
            year: 2024,
        });
    });

    it('uppercases --country-code', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify([sampleSession]), { status: 200 }));
        });
        await cmd.func({ 'country-code': 'brn' });
        expect(calls[0]).toContain('country_code=BRN');
    });
});

describe('openf1 drivers', () => {
    const cmd = getRegistry().get('openf1/drivers');

    it('rejects missing session-key', async () => {
        await expect(cmd.func({})).rejects.toBeInstanceOf(ArgumentError);
    });

    it('shapes driver rows', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify([sampleDriver]), { status: 200 })));
        const rows = await cmd.func({ 'session-key': 9472 });
        expect(rows[0]).toMatchObject({
            driverNumber: 1,
            nameAcronym: 'VER',
            teamName: 'Red Bull Racing',
            countryCode: 'NED',
        });
    });

    it('threads --driver-number to query string', async () => {
        const calls = [];
        global.fetch = vi.fn((url) => {
            calls.push(url);
            return Promise.resolve(new Response(JSON.stringify([sampleDriver]), { status: 200 }));
        });
        await cmd.func({ 'session-key': 9472, 'driver-number': 1 });
        expect(calls[0]).toContain('driver_number=1');
    });
});
