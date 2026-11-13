import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

import {
  absolutizeUrl,
  aggregateStatsMapsToSeries,
  assertRequiredFields,
  buildTeamMatchesUrl,
  buildTeamStatsMatchesUrl,
  extractIdFromUrl,
  normalizeMatchUrl,
  parseEventRef,
  parsePlayerRef,
  parseTeamRef,
} from './utils.js';

describe('hltv argument normalization', () => {
  it('accepts compact ids and first-party HLTV URLs', () => {
    expect(parsePlayerRef('3741/niko')).toEqual({ playerId: '3741', slug: 'niko' });
    expect(parsePlayerRef('https://www.hltv.org/player/3741/niko')).toEqual({ playerId: '3741', slug: 'niko' });
    expect(parseTeamRef('6667/falcons')).toEqual({ teamId: '6667', slug: 'falcons' });
    expect(parseTeamRef('https://www.hltv.org/team/6667/falcons')).toEqual({ teamId: '6667', slug: 'falcons' });
    expect(parseEventRef('https://www.hltv.org/events/8301/demo')).toBe('8301');
    expect(normalizeMatchUrl('https://www.hltv.org/stats/matches/mapstatsid/231594/falcons-vs-natus-vincere').pathname)
      .toBe('/stats/matches/mapstatsid/231594/falcons-vs-natus-vincere');
  });

  it('rejects off-domain URLs before browser navigation', () => {
    expect(() => parsePlayerRef('https://evil.test/player/3741/niko')).toThrow(ArgumentError);
    expect(() => parseTeamRef('https://evil.test/team/6667/falcons')).toThrow(ArgumentError);
    expect(() => parseEventRef('https://evil.test/stats/matches?event=8301')).toThrow(ArgumentError);
    expect(() => normalizeMatchUrl('https://evil.test/stats/matches/mapstatsid/231594/demo')).toThrow(ArgumentError);
    expect(() => parsePlayerRef('https://')).toThrow(ArgumentError);
  });

  it('requires numeric event ids in stats URLs', () => {
    expect(() => parseEventRef('https://www.hltv.org/stats/matches?event=not-an-id')).toThrow(ArgumentError);
  });
});

describe('hltv row identity contract', () => {
  it('extracts ids only from first-party HLTV URLs', () => {
    expect(extractIdFromUrl('https://www.hltv.org/player/3741/niko', 'player')).toBe('3741');
    expect(extractIdFromUrl('https://evil.test/player/3741/niko', 'player')).toBeNull();
    expect(extractIdFromUrl('https://', 'player')).toBeNull();
    expect(() => absolutizeUrl('https://')).toThrow(CommandExecutionError);
  });

  it('typed-fails rows missing required round-trip identities', () => {
    expect(() => assertRequiredFields([
      { rank: 1, type: 'player', id: null, url: 'https://www.hltv.org/player/3741/niko' },
    ], 'hltv search', ['rank', 'type', 'id', 'url'])).toThrow(CommandExecutionError);

    expect(() => assertRequiredFields([
      { rank: 1, type: 'player', id: '3741', url: 'https://www.hltv.org/player/3741/niko' },
    ], 'hltv search', ['rank', 'type', 'id', 'url'])).not.toThrow();
  });
});

describe('hltv team-matches period routing', () => {
  it('serves recent matches from the team profile page', () => {
    const { url } = buildTeamMatchesUrl({ team: '7020/team-spirit' });
    expect(url.pathname).toBe('/team/7020/team-spirit');
    expect(url.searchParams.get('startDate')).toBe('all');
    expect(url.searchParams.has('endDate')).toBe(false);
  });

  it('routes an explicit period to the stats matches page, which honours the date range', () => {
    const { url } = buildTeamStatsMatchesUrl({ team: '7020/team-spirit', period: '2024' });
    expect(url.pathname).toBe('/stats/teams/matches/7020/team-spirit');
    expect(url.searchParams.get('startDate')).toBe('2024-01-01');
    expect(url.searchParams.get('endDate')).toBe('2024-12-31');
  });
});

describe('hltv team-matches stats aggregation', () => {
  it('collapses per-map rows into one series row per date/event/opponent', () => {
    const series = aggregateStatsMapsToSeries([
      { date: '23/11/24', event: 'EU RMR B', opponent: 'G2', map: 'Nuke', outcome: 'L', matchId: '1', matchUrl: 'https://www.hltv.org/stats/matches/mapstatsid/1/a' },
      { date: '23/11/24', event: 'EU RMR B', opponent: 'G2', map: 'Mirage', outcome: 'W', matchId: '2', matchUrl: 'https://www.hltv.org/stats/matches/mapstatsid/2/b' },
      { date: '23/11/24', event: 'EU RMR B', opponent: 'G2', map: 'Ancient', outcome: 'L', matchId: '3', matchUrl: 'https://www.hltv.org/stats/matches/mapstatsid/3/c' },
      { date: '24/11/24', event: 'EU RMR B', opponent: 'Sashi', map: 'Dust2', outcome: 'W', matchId: '4', matchUrl: null },
    ]);

    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({
      date: '23/11/24',
      opponent: 'G2',
      teamScore: 1,
      opponentScore: 2,
      maps: 3,
      matchId: '1',
    });
    expect(series[1]).toMatchObject({ date: '24/11/24', opponent: 'Sashi', teamScore: 1, opponentScore: 0, maps: 1 });
  });

  it('keeps same-day series against different opponents separate', () => {
    const series = aggregateStatsMapsToSeries([
      { date: '24/11/24', event: 'EU RMR B', opponent: 'Sashi', map: 'Dust2', outcome: 'W' },
      { date: '24/11/24', event: 'EU RMR B', opponent: 'Ninjas in Pyjamas', map: 'Mirage', outcome: 'L' },
    ]);
    expect(series.map((row) => row.opponent)).toEqual(['Sashi', 'Ninjas in Pyjamas']);
  });
});
