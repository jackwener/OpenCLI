import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import './event-matches.js';
import './match-map.js';
import './match-series.js';
import './player-duel.js';
import './player-form.js';
import './player-map-pool.js';
import './player-matches.js';
import './player-summary.js';
import './player-teammate-impact.js';
import './player-vs-team.js';
import './search.js';
import './team-map-pool.js';
import './team-matches.js';
import {
  absolutizeUrl,
  assertRequiredFields,
  extractIdFromUrl,
  normalizeMatchUrl,
  parseEventRef,
  parsePlayerRef,
  parseTeamRef,
} from './utils.js';

describe('hltv command registration', () => {
  it('registers the read-only HLTV browser commands', () => {
    const commands = [
      'event-matches',
      'match-map',
      'match-series',
      'player-duel',
      'player-form',
      'player-map-pool',
      'player-matches',
      'player-summary',
      'player-teammate-impact',
      'player-vs-team',
      'search',
      'team-map-pool',
      'team-matches',
    ];

    for (const name of commands) {
      const command = getRegistry().get(`hltv/${name}`);
      expect(command, `hltv/${name}`).toBeDefined();
      expect(command.access).toBe('read');
      expect(command.browser).toBe(true);
      expect(command.navigateBefore).toBe(false);
      expect(command.domain).toBe('www.hltv.org');
    }
  });
});

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
