import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeLimit, readPlayerMatches } from './utils.js';

cli({
  site: 'hltv',
  name: 'player-matches',
  description: 'Read HLTV player match history from the stats Matches tab',
  access: 'read',
  example: 'opencli hltv player-matches --player 3741/niko --limit 10 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'player', type: 'string', default: '3741/niko', help: 'Player ref: 3741/niko, player URL, or stats matches URL' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset; must be a multiple of 100' },
    { name: 'limit', type: 'int', default: 100, help: 'Rows to return from the current page (max 100)' },
  ],
  columns: ['rank', 'date', 'playerTeam', 'opponent', 'map', 'kills', 'deaths', 'plusMinus', 'rating', 'playerId', 'matchStatsId', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    return readPlayerMatches(page, args, limit);
  },
});
