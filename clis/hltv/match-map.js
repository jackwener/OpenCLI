import { cli, Strategy } from '@jackwener/opencli/registry';
import { readMatchMap } from './utils.js';

cli({
  site: 'hltv',
  name: 'match-map',
  description: 'Read a single HLTV mapstats page and return all player rows for that map',
  access: 'read',
  example: 'opencli hltv match-map "https://www.hltv.org/stats/matches/mapstatsid/231594/falcons-vs-natus-vincere" -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'match', type: 'string', positional: true, required: true, help: 'Full HLTV /stats/matches/mapstatsid/:id/:slug URL from player-matches' },
  ],
  columns: ['matchStatsId', 'playerId', 'playerName', 'team', 'kills', 'deaths', 'adr', 'kastPct', 'rating', 'opKd', 'details', 'url'],
  func: async (page, args) => {
    return readMatchMap(page, args.match);
  },
});
