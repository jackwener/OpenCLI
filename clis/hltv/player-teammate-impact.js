import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeLimit, parsePlayerRef, readPlayerMatches } from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function summarize(category, key, rows, player) {
  const kills = rows.reduce((acc, row) => acc + (row.kills ?? 0), 0);
  const deaths = rows.reduce((acc, row) => acc + (row.deaths ?? 0), 0);
  const ratings = rows.map((row) => row.rating).filter(Number.isFinite);
  const wins = rows.filter((row) => row.details?.result === 'win').length;
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  return {
    category,
    key,
    playerId: player.playerId,
    maps: rows.length,
    avgRating: ratings.length ? round(ratings.reduce((acc, value) => acc + value, 0) / ratings.length) : null,
    kdRatio: deaths > 0 ? round(kills / deaths) : null,
    killsPerMap: rows.length ? round(kills / rows.length) : null,
    plusMinusTotal: rows.reduce((acc, row) => acc + (row.plusMinus ?? 0), 0),
    winMaps: wins,
    lossMaps: rows.length - wins,
    details: {
      nickname: rows[0]?.details?.nickname ?? player.slug,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      deathsPerMap: rows.length ? round(deaths / rows.length) : null,
      matchStatsIds: rows.map((row) => row.matchStatsId).filter(Boolean).join(','),
    },
  };
}

cli({
  site: 'hltv',
  name: 'player-teammate-impact',
  description: 'Compare playerA maps with and without playerB present in the scanned sample',
  access: 'read',
  example: 'opencli hltv player-teammate-impact 3741/niko 19230/m0nesy --limit 50 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'playerA', type: 'string', positional: true, required: true, help: 'Primary player ref' },
    { name: 'playerB', type: 'string', positional: true, required: true, help: 'Teammate player ref' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'event', type: 'string', default: 'all', help: 'all / event id / /events/:id URL / stats URL with event=' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset; must be a multiple of 100' },
    { name: 'limit', type: 'int', default: 100, help: 'Rows to scan for each player from the current page (max 100)' },
  ],
  columns: ['category', 'key', 'playerId', 'maps', 'avgRating', 'kdRatio', 'killsPerMap', 'plusMinusTotal', 'winMaps', 'lossMaps', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    const playerA = parsePlayerRef(args.playerA);
    const playerB = parsePlayerRef(args.playerB);
    const commonArgs = {
      period: args.period,
      eventType: args.eventType,
      event: args.event,
      ranking: args.ranking,
      map: args.map,
      version: args.version,
      offset: args.offset,
    };
    const aRows = await readPlayerMatches(page, { ...commonArgs, player: args.playerA }, limit);
    const bRows = await readPlayerMatches(page, { ...commonArgs, player: args.playerB }, limit);
    const bIds = new Set(bRows.map((row) => row.matchStatsId).filter(Boolean));
    const withB = aRows.filter((row) => bIds.has(row.matchStatsId));
    const withoutB = aRows.filter((row) => !bIds.has(row.matchStatsId));
    if (withB.length === 0) {
      throw new EmptyResultError('hltv player-teammate-impact', `No shared map rows found for ${playerA.playerId} and ${playerB.playerId}`);
    }
    const rows = [
      summarize('summary', 'withTeammate', withB, playerA),
      summarize('summary', 'withoutTeammate', withoutB, playerA),
    ];
    const byMap = new Map();
    for (const row of withB) {
      if (!byMap.has(row.map)) byMap.set(row.map, []);
      byMap.get(row.map).push(row);
    }
    for (const [mapName, mapRows] of [...byMap.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      rows.push(summarize('map', mapName, mapRows, playerA));
    }
    return rows;
  },
});
