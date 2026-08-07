import { cli, Strategy } from '@jackwener/opencli/registry';
import { readMatchSeries } from './utils.js';

cli({
  site: 'hltv',
  name: 'match-series',
  description: 'Expand an HLTV match or stats series into summary, map, and player rows',
  access: 'read',
  example: 'opencli hltv match-series https://www.hltv.org/stats/matches/126993/spirit-vs-falcons -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'match', type: 'string', positional: true, required: true, help: 'HLTV match, stats series, or mapstats URL' },
  ],
  columns: ['rowType', 'date', 'event', 'map', 'team', 'opponent', 'score', 'matchStatsId', 'playerId', 'playerName', 'rating', 'details'],
  func: async (page, args) => {
    return readMatchSeries(page, args.match);
  },
});
