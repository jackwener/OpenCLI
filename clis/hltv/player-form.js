import { cli, Strategy } from '@jackwener/opencli/registry';
import { normalizeLimit, readPlayerMatches } from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function createBucket(category, key, seed) {
  const bucket = {};
  bucket.category = category;
  bucket.key = key;
  bucket.playerId = seed.playerId;
  bucket.nickname = seed.details?.nickname ?? null;
  bucket.maps = 0;
  bucket._kills = 0;
  bucket._deaths = 0;
  bucket.plusMinusTotal = 0;
  bucket._ratingSum = 0;
  bucket._ratingCount = 0;
  bucket.winMaps = 0;
  bucket.lossMaps = 0;
  bucket._dates = [];
  bucket._bestRating = null;
  bucket._worstRating = null;
  bucket._filters = seed.details?.filters ?? null;
  return bucket;
}

function addMatch(bucket, row) {
  bucket.maps += 1;
  bucket._kills += row.kills ?? 0;
  bucket._deaths += row.deaths ?? 0;
  bucket.plusMinusTotal += row.plusMinus ?? ((row.kills ?? 0) - (row.deaths ?? 0));
  if (Number.isFinite(row.rating)) {
    bucket._ratingSum += row.rating;
    bucket._ratingCount += 1;
    bucket._bestRating = bucket._bestRating === null ? row.rating : Math.max(bucket._bestRating, row.rating);
    bucket._worstRating = bucket._worstRating === null ? row.rating : Math.min(bucket._worstRating, row.rating);
  }
  if (row.details?.result === 'win') bucket.winMaps += 1;
  if (row.details?.result === 'loss') bucket.lossMaps += 1;
  if (row.date) bucket._dates.push(row.date);
}

function finalizeBucket(bucket) {
  const sortedDates = [...bucket._dates].sort();
  return {
    category: bucket.category,
    key: bucket.key,
    playerId: bucket.playerId,
    nickname: bucket.nickname,
    maps: bucket.maps,
    avgRating: bucket._ratingCount ? round(bucket._ratingSum / bucket._ratingCount) : null,
    kdRatio: bucket._deaths > 0 ? round(bucket._kills / bucket._deaths) : null,
    killsPerMap: bucket.maps ? round(bucket._kills / bucket.maps) : null,
    plusMinusTotal: bucket.plusMinusTotal,
    winMaps: bucket.winMaps,
    lossMaps: bucket.lossMaps,
    details: {
      firstDate: sortedDates[0] ?? null,
      lastDate: sortedDates[sortedDates.length - 1] ?? null,
      deathsPerMap: bucket.maps ? round(bucket._deaths / bucket.maps) : null,
      bestRating: bucket._bestRating,
      worstRating: bucket._worstRating,
      filters: bucket._filters,
    },
  };
}

function buildBuckets(rows) {
  const first = rows[0];
  const buckets = [createBucket('summary', 'all', first)];
  const byMap = new Map();
  const byOpponent = new Map();

  for (const row of rows) {
    addMatch(buckets[0], row);

    if (!byMap.has(row.map)) byMap.set(row.map, createBucket('map', row.map, first));
    addMatch(byMap.get(row.map), row);

    if (!byOpponent.has(row.opponent)) byOpponent.set(row.opponent, createBucket('opponent', row.opponent, first));
    addMatch(byOpponent.get(row.opponent), row);
  }

  const sortBuckets = (items) => [...items].sort((a, b) => b.maps - a.maps || String(a.key).localeCompare(String(b.key)));
  return [
    buckets[0],
    ...sortBuckets(byMap.values()),
    ...sortBuckets(byOpponent.values()),
  ].map(finalizeBucket);
}

cli({
  site: 'hltv',
  name: 'player-form',
  description: 'Aggregate recent HLTV player maps into form summaries grouped by summary, map, and opponent',
  access: 'read',
  example: 'opencli hltv player-form --player 19230/m0nesy --limit 30 -f json',
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
    { name: 'limit', type: 'int', default: 30, help: 'Recent maps to aggregate from the current page (max 100)' },
  ],
  columns: ['category', 'key', 'playerId', 'nickname', 'maps', 'avgRating', 'kdRatio', 'killsPerMap', 'plusMinusTotal', 'winMaps', 'lossMaps', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 30, 100);
    const rows = await readPlayerMatches(page, args, limit);
    return buildBuckets(rows);
  },
});
