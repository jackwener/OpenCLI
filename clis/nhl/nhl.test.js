import { describe, it, expect, vi, afterEach } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import './standings.js';
import './schedule.js';

const origFetch = global.fetch;
afterEach(() => { global.fetch = origFetch; });

describe('nhl standings', () => {
    const cmd = getRegistry().get('nhl/standings');

    it('rejects badly-formatted --date', async () => {
        await expect(cmd.func({ date: 'tomorrow' })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('rejects non-positive --limit', async () => {
        await expect(cmd.func({ limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty standings to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ standings: [] }), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('shapes a standings row and computes home/road/L10 records', async () => {
        const sample = {
            standings: [{
                teamAbbrev: { default: 'BOS' },
                teamName: { default: 'Boston Bruins' },
                conferenceName: 'Eastern',
                divisionName: 'Atlantic',
                gamesPlayed: 50, wins: 32, losses: 12, otLosses: 6, points: 70,
                pointPctg: 0.7, goalDifferential: 25,
                streakCode: 'W', streakCount: 3,
                homeWins: 20, homeLosses: 4, homeOtLosses: 1,
                roadWins: 12, roadLosses: 8, roadOtLosses: 5,
                l10Wins: 7, l10Losses: 2, l10OtLosses: 1,
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0].teamAbbrev).toBe('BOS');
        expect(rows[0].pointPct).toBe(0.7);
        expect(rows[0].homeRecord).toBe('20-4-1');
        expect(rows[0].l10Record).toBe('7-2-1');
        expect(rows[0].rank).toBe(1);
    });
});

describe('nhl schedule', () => {
    const cmd = getRegistry().get('nhl/schedule');

    it('rejects --limit > 200', async () => {
        await expect(cmd.func({ limit: 999 })).rejects.toBeInstanceOf(ArgumentError);
    });

    it('promotes empty week to EmptyResultError', async () => {
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ gameWeek: [{ date: '2026-05-06', games: [] }] }), { status: 200 })));
        await expect(cmd.func({})).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('flattens days→games and labels game type', async () => {
        const sample = {
            gameWeek: [{
                date: '2026-05-06',
                games: [{
                    id: 2025020842,
                    startTimeUTC: '2026-05-06T23:00:00Z',
                    gameType: 2,
                    awayTeam: { abbrev: 'TOR', placeName: { default: 'Toronto' }, score: 4 },
                    homeTeam: { abbrev: 'BOS', placeName: { default: 'Boston' }, score: 2 },
                    venue: { default: 'TD Garden' },
                    gameState: 'OFF',
                }],
            }],
        };
        global.fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(sample), { status: 200 })));
        const rows = await cmd.func({});
        expect(rows[0].gameId).toBe(2025020842);
        expect(rows[0].gameType).toBe('regular');
        expect(rows[0].awayAbbrev).toBe('TOR');
        expect(rows[0].homeAbbrev).toBe('BOS');
        expect(rows[0].url).toBe('https://www.nhl.com/gamecenter/2025020842');
    });
});
