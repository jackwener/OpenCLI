import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
  normalizeLimit,
  normalizeOffset,
  parsePlayerRef,
  readMatchMap,
  readPerformanceKillMatrix,
  readPlayerMatches,
  resolveMatchMapUrls,
  resolveStatsSeriesUrlFromMap,
} from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function normalizeScanPages(value) {
  const raw = value ?? 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('scanPages must be a positive integer');
  if (n > 5) throw new ArgumentError('scanPages must be <= 5');
  return n;
}

function normalizeRecentMaps(value) {
  const raw = value ?? 100;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ArgumentError('recentMaps must be a positive integer');
  if (n > 500) throw new ArgumentError('recentMaps must be <= 500');
  return n;
}

function normalizeMode(value) {
  const raw = String(value ?? 'lastEncounter');
  if (!['lastEncounter', 'intersection', 'history'].includes(raw)) {
    throw new ArgumentError('mode must be one of: lastEncounter, intersection, history');
  }
  return raw;
}

function findPlayer(rows, playerId) {
  return rows.find((row) => row.playerId === playerId) ?? null;
}

function parseDirectDuel(matrix, playerAName, playerBName) {
  const norm = (value) => String(value ?? '').trim().toLowerCase();
  const a = norm(playerAName);
  const b = norm(playerBName);
  const rowA = matrix.find((item) => norm(item.rowPlayer) === a && norm(item.colPlayer) === b);
  if (rowA) {
    return { playerAKillsPlayerB: rowA.rowKillsCol, playerBKillsPlayerA: rowA.colKillsRow };
  }
  const rowB = matrix.find((item) => norm(item.rowPlayer) === b && norm(item.colPlayer) === a);
  if (rowB) {
    return { playerAKillsPlayerB: rowB.colKillsRow, playerBKillsPlayerA: rowB.rowKillsCol };
  }
  return { playerAKillsPlayerB: null, playerBKillsPlayerA: null };
}

function toMapRow(scope, mapstatsUrl, playerA, playerB, direct) {
  const directKillDiff = direct.playerAKillsPlayerB === null || direct.playerBKillsPlayerA === null
    ? null
    : direct.playerAKillsPlayerB - direct.playerBKillsPlayerA;
  return {
    rowType: 'map',
    scope,
    date: playerA.details?.dateTime?.slice(0, 10) ?? null,
    event: playerA.details?.event ?? null,
    map: playerA.details?.map ?? null,
    matchStatsId: playerA.matchStatsId,
    playerAId: playerA.playerId,
    playerBId: playerB.playerId,
    ratingDiff: playerA.rating === null || playerB.rating === null ? null : round(playerA.rating - playerB.rating),
    killDiff: playerA.kills === null || playerB.kills === null ? null : playerA.kills - playerB.kills,
    directKillDiff,
    details: {
      playerAName: playerA.playerName,
      playerBName: playerB.playerName,
      playerATeam: playerA.team,
      playerBTeam: playerB.team,
      playerAKills: playerA.kills,
      playerBKills: playerB.kills,
      playerADeaths: playerA.deaths,
      playerBDeaths: playerB.deaths,
      playerARating: playerA.rating,
      playerBRating: playerB.rating,
      playerAAdr: playerA.adr,
      playerBAdr: playerB.adr,
      playerAKastPct: playerA.kastPct,
      playerBKastPct: playerB.kastPct,
      playerAOpKd: playerA.opKd,
      playerBOpKd: playerB.opKd,
      playerAKillsPlayerB: direct.playerAKillsPlayerB,
      playerBKillsPlayerA: direct.playerBKillsPlayerA,
      teamScore: playerA.details?.teamScore ?? null,
      opponentScore: playerA.details?.opponentScore ?? null,
      matchStatsUrl: mapstatsUrl,
    },
  };
}

function toSummaryRow(scope, rows, context = {}) {
  const first = rows[0];
  const withDirect = rows.filter((row) => row.directKillDiff !== null);
  const sum = (values) => values.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0);
  const avg = (values) => {
    const valid = values.filter((value) => Number.isFinite(value));
    return valid.length ? round(sum(valid) / valid.length) : null;
  };
  const details = rows.reduce((acc, row) => {
    acc.playerAKills += row.details.playerAKills ?? 0;
    acc.playerBKills += row.details.playerBKills ?? 0;
    acc.playerADeaths += row.details.playerADeaths ?? 0;
    acc.playerBDeaths += row.details.playerBDeaths ?? 0;
    acc.playerAKillsPlayerB += row.details.playerAKillsPlayerB ?? 0;
    acc.playerBKillsPlayerA += row.details.playerBKillsPlayerA ?? 0;
    return acc;
  }, {
    playerAName: first?.details.playerAName ?? null,
    playerBName: first?.details.playerBName ?? null,
    playerAKills: 0,
    playerBKills: 0,
    playerADeaths: 0,
    playerBDeaths: 0,
    playerAKillsPlayerB: 0,
    playerBKillsPlayerA: 0,
    mapsWithDirectDuel: withDirect.length,
    firstDate: rows.map((row) => row.date).filter(Boolean).sort()[0] ?? null,
    lastDate: rows.map((row) => row.date).filter(Boolean).sort().at(-1) ?? null,
    seriesUrl: context.seriesUrl ?? null,
    matchedMapStats: context.matchedMapStatsId ?? null,
  });
  if (withDirect.length === 0) {
    details.playerAKillsPlayerB = null;
    details.playerBKillsPlayerA = null;
  }

  return {
    rowType: 'summary',
    scope,
    date: details.lastDate,
    event: first?.event ?? null,
    map: 'all',
    matchStatsId: 'all',
    playerAId: first?.playerAId ?? null,
    playerBId: first?.playerBId ?? null,
    ratingDiff: avg(rows.map((row) => row.ratingDiff)),
    killDiff: sum(rows.map((row) => row.killDiff)),
    directKillDiff: withDirect.length ? sum(rows.map((row) => row.directKillDiff)) : null,
    details,
  };
}

async function collectCommonMapUrls(page, args, limit, scanPages) {
  const offset = normalizeOffset(args.offset, 0);
  const playerA = parsePlayerRef(args.playerA);
  const playerB = parsePlayerRef(args.playerB);
  const aRows = [];
  const bRows = [];

  for (let i = 0; i < scanPages; i += 1) {
    const pageOffset = offset + i * 100;
    const commonArgs = {
      period: args.period,
      eventType: args.eventType,
      event: args.event,
      ranking: args.ranking,
      map: args.map,
      version: args.version,
      offset: pageOffset,
    };
    aRows.push(...await readPlayerMatches(page, { ...commonArgs, player: args.playerA }, 100));
    bRows.push(...await readPlayerMatches(page, { ...commonArgs, player: args.playerB }, 100));
  }

  const bByMatchStatsId = new Map(bRows.map((row) => [row.matchStatsId, row]));
  const urls = [];
  const seen = new Set();
  for (const aRow of aRows) {
    if (urls.length >= limit) break;
    if (!aRow.matchStatsId || seen.has(aRow.matchStatsId) || !bByMatchStatsId.has(aRow.matchStatsId)) continue;
    seen.add(aRow.matchStatsId);
    urls.push(aRow.details.matchStatsUrl);
  }
  if (urls.length === 0) {
    throw new EmptyResultError('hltv player-duel', `No common mapstats rows found for ${playerA.playerId} and ${playerB.playerId}`);
  }
  return urls;
}

async function collectHistorySeriesMapUrls(page, args, limit, scanPages) {
  const commonMapUrls = await collectCommonMapUrls(page, args, limit, scanPages);
  const seriesUrls = [];
  const seenSeries = new Set();
  for (const mapUrl of commonMapUrls) {
    const seriesUrl = await resolveStatsSeriesUrlFromMap(page, mapUrl);
    if (seenSeries.has(seriesUrl)) continue;
    seenSeries.add(seriesUrl);
    seriesUrls.push(seriesUrl);
    if (seriesUrls.length >= limit) break;
  }

  const mapUrls = [];
  const seenMaps = new Set();
  for (const seriesUrl of seriesUrls) {
    const seriesMapUrls = await resolveMatchMapUrls(page, seriesUrl);
    for (const mapUrl of seriesMapUrls) {
      const id = new URL(mapUrl).pathname.match(/mapstatsid\/(\d+)\//)?.[1] ?? mapUrl;
      if (seenMaps.has(id)) continue;
      seenMaps.add(id);
      mapUrls.push(mapUrl);
    }
  }
  return { mapUrls, seriesUrls };
}

async function collectPlayerMatchesByRef(page, args, player, recentMaps) {
  const rows = [];
  let offset = normalizeOffset(args.offset, 0);
  while (rows.length < recentMaps) {
    const chunkLimit = Math.min(100, recentMaps - rows.length);
    const chunk = await readPlayerMatches(page, {
      player,
      period: args.period,
      eventType: args.eventType,
      event: args.event,
      ranking: args.ranking,
      map: args.map,
      version: args.version,
      offset,
    }, chunkLimit);
    rows.push(...chunk);
    if (chunk.length < chunkLimit) break;
    offset += 100;
  }
  return rows.slice(0, recentMaps);
}

async function findLastEncounterSeries(page, args, recentMaps) {
  const playerA = parsePlayerRef(args.playerA);
  const playerB = parsePlayerRef(args.playerB);
  const candidates = await collectPlayerMatchesByRef(page, args, args.playerA, recentMaps);
  const playerBMatches = await collectPlayerMatchesByRef(page, args, args.playerB, recentMaps);
  const playerBMatchIds = new Set(playerBMatches.map((row) => row.matchStatsId).filter(Boolean));
  const seen = new Set();

  for (const candidate of candidates) {
    const mapUrl = candidate.details?.matchStatsUrl;
    if (!mapUrl || seen.has(candidate.matchStatsId)) continue;
    seen.add(candidate.matchStatsId);
    if (!playerBMatchIds.has(candidate.matchStatsId)) continue;

    const mapRows = await readMatchMap(page, mapUrl);
    if (!findPlayer(mapRows, playerB.playerId)) continue;

    const seriesUrl = await resolveStatsSeriesUrlFromMap(page, mapUrl);
    const mapUrls = await resolveMatchMapUrls(page, seriesUrl);
    return {
      mapUrls,
      matchedMapStatsId: candidate.matchStatsId,
      seriesUrl,
    };
  }

  throw new EmptyResultError(
    'hltv player-duel',
    `No last encounter found for ${playerA.playerId} and ${playerB.playerId} in the latest ${recentMaps} maps from playerA`,
  );
}

async function buildDuelRows(page, args, mapUrls, scope, limit, context = {}) {
  const playerA = parsePlayerRef(args.playerA);
  const playerB = parsePlayerRef(args.playerB);
  const rows = [];

  for (const mapUrl of mapUrls.slice(0, limit)) {
    const mapRows = await readMatchMap(page, mapUrl);
    const playerARow = findPlayer(mapRows, playerA.playerId);
    const playerBRow = findPlayer(mapRows, playerB.playerId);
    if (!playerARow || !playerBRow) continue;
    const matrix = playerARow.team === playerBRow.team ? [] : await readPerformanceKillMatrix(page, mapUrl);
    const direct = parseDirectDuel(matrix, playerARow.playerName, playerBRow.playerName);
    rows.push(toMapRow(scope, mapUrl, playerARow, playerBRow, direct));
  }

  if (rows.length === 0) {
    throw new EmptyResultError('hltv player-duel', 'The selected players were not both present in the resolved mapstats pages');
  }
  return [toSummaryRow(scope, rows, context), ...rows];
}

cli({
  site: 'hltv',
  name: 'player-duel',
  description: 'Compare two HLTV players on shared maps, including direct kill matrix when available',
  access: 'read',
  example: 'opencli hltv player-duel 19230/m0nesy 3741/niko --match https://www.hltv.org/stats/matches/mapstatsid/231594/falcons-vs-natus-vincere -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'playerA', type: 'string', positional: true, required: true, help: 'First player ref: 19230/m0nesy, player URL, or stats player URL' },
    { name: 'playerB', type: 'string', positional: true, required: true, help: 'Second player ref: 3741/niko, player URL, or stats player URL' },
    { name: 'match', type: 'string', default: '', help: 'Optional HLTV match, stats series, or mapstats URL' },
    { name: 'mode', type: 'string', default: 'lastEncounter', help: 'lastEncounter / intersection / history. Ignored when --match is provided' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'event', type: 'string', default: 'all', help: 'all / event id / /events/:id URL / stats URL with event=' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset for broad mode; must be a multiple of 100' },
    { name: 'recentMaps', type: 'int', default: 100, help: 'lastEncounter mode candidate maps from playerA to scan (max 500)' },
    { name: 'scanPages', type: 'int', default: 1, help: 'Broad mode pages to scan, 100 rows each (max 5)' },
    { name: 'limit', type: 'int', default: 20, help: 'Maximum shared maps to compare (max 100)' },
  ],
  columns: ['rowType', 'scope', 'date', 'event', 'map', 'matchStatsId', 'playerAId', 'playerBId', 'ratingDiff', 'killDiff', 'directKillDiff', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 20, 100);
    const scanPages = normalizeScanPages(args.scanPages);
    const recentMaps = normalizeRecentMaps(args.recentMaps);
    const mode = normalizeMode(args.mode);
    parsePlayerRef(args.playerA);
    parsePlayerRef(args.playerB);

    const match = String(args.match ?? '').trim();
    let mapUrls;
    let scope;
    let context = {};
    if (match) {
      mapUrls = await resolveMatchMapUrls(page, match);
      scope = 'match';
    } else if (mode === 'intersection') {
      mapUrls = await collectCommonMapUrls(page, args, limit, scanPages);
      scope = 'filters';
    } else if (mode === 'history') {
      const history = await collectHistorySeriesMapUrls(page, args, limit, scanPages);
      mapUrls = history.mapUrls;
      scope = 'history';
      context = {
        seriesUrl: history.seriesUrls.join(','),
      };
    } else {
      const lastEncounter = await findLastEncounterSeries(page, args, recentMaps);
      mapUrls = lastEncounter.mapUrls;
      scope = 'lastEncounter';
      context = {
        seriesUrl: lastEncounter.seriesUrl,
        matchedMapStatsId: lastEncounter.matchedMapStatsId,
      };
    }
    const effectiveLimit = scope === 'lastEncounter' || scope === 'match' ? mapUrls.length : limit;
    return buildDuelRows(page, args, mapUrls, scope, effectiveLimit, context);
  },
});
