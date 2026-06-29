import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeLimit, readPlayerMatches } from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function bucket(category, key, seed) {
  const target = {};
  target.category = category;
  target.key = key;
  target.playerId = seed.playerId;
  target.nickname = seed.details?.nickname ?? null;
  target.maps = 0;
  target._wins = 0;
  target._losses = 0;
  target._kills = 0;
  target._deaths = 0;
  target.plusMinusTotal = 0;
  target._ratingSum = 0;
  target._ratingCount = 0;
  target._dates = [];
  target._filters = seed.details?.filters ?? null;
  return target;
}

function add(row, target) {
  target.maps += 1;
  target._kills += row.kills ?? 0;
  target._deaths += row.deaths ?? 0;
  target.plusMinusTotal += row.plusMinus ?? ((row.kills ?? 0) - (row.deaths ?? 0));
  if (row.details?.result === 'win') target._wins += 1;
  if (row.details?.result === 'loss') target._losses += 1;
  if (Number.isFinite(row.rating)) {
    target._ratingSum += row.rating;
    target._ratingCount += 1;
  }
  if (row.date) target._dates.push(row.date);
}

function finish(target) {
  const dates = [...target._dates].sort();
  return {
    category: target.category,
    key: target.key,
    playerId: target.playerId,
    nickname: target.nickname,
    maps: target.maps,
    avgRating: target._ratingCount ? round(target._ratingSum / target._ratingCount) : null,
    kdRatio: target._deaths > 0 ? round(target._kills / target._deaths) : null,
    killsPerMap: target.maps ? round(target._kills / target.maps) : null,
    plusMinusTotal: target.plusMinusTotal,
    winMaps: target._wins,
    lossMaps: target._losses,
    details: {
      winRatePct: target.maps ? round((target._wins / target.maps) * 100) : null,
      deathsPerMap: target.maps ? round(target._deaths / target.maps) : null,
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      filters: target._filters,
    },
  };
}

function aggregate(rows) {
  const first = rows[0];
  const all = bucket('summary', 'all', first);
  const maps = new Map();
  for (const row of rows) {
    add(row, all);
    if (!maps.has(row.map)) maps.set(row.map, bucket('map', row.map, first));
    add(row, maps.get(row.map));
  }
  return [all, ...[...maps.values()].sort((a, b) => b.maps - a.maps || a.key.localeCompare(b.key))].map(finish);
}

cli({
  site: 'hltv',
  name: 'player-map-pool',
  description: 'Aggregate a player matches page into per-map performance buckets',
  access: 'read',
  example: 'opencli hltv player-map-pool --player 3741/niko --limit 50 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'player', type: 'string', default: '3741/niko', help: 'Player ref: 3741/niko, player URL, or stats player URL' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'event', type: 'string', default: 'all', help: 'all / event id / /events/:id URL / stats URL with event=' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset; must be a multiple of 100' },
    { name: 'limit', type: 'int', default: 100, help: 'Recent maps to aggregate from the current page (max 100)' },
  ],
  columns: ['category', 'key', 'playerId', 'nickname', 'maps', 'avgRating', 'kdRatio', 'killsPerMap', 'plusMinusTotal', 'winMaps', 'lossMaps', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    return aggregate(await readPlayerMatches(page, args, limit));
  },
});
