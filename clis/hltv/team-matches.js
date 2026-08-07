import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeLimit, readTeamMatches } from './utils.js';

cli({
  site: 'hltv',
  name: 'team-matches',
  description: 'Read recent HLTV team map results from the stats team matches page',
  access: 'read',
  example: 'opencli hltv team-matches 6667/falcons --limit 10 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'team', type: 'string', positional: true, required: true, help: 'Team ref: 6667/falcons, team URL, or stats team URL' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'event', type: 'string', default: 'all', help: 'all / event id / /events/:id URL / stats URL with event=' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset; must be a multiple of 100' },
    { name: 'limit', type: 'int', default: 100, help: 'Rows to return from the current page (max 100)' },
  ],
  columns: ['rank', 'date', 'team', 'opponent', 'map', 'result', 'teamId', 'matchStatsId', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    return readTeamMatches(page, args, limit);
  },
});
