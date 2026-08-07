import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeLimit, parseTeamRef, readPlayerMatches } from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function norm(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function summarize(rows, teamRef) {
  const kills = rows.reduce((acc, row) => acc + (row.kills ?? 0), 0);
  const deaths = rows.reduce((acc, row) => acc + (row.deaths ?? 0), 0);
  const ratingRows = rows.filter((row) => Number.isFinite(row.rating));
  const wins = rows.filter((row) => row.details?.result === 'win').length;
  const dates = rows.map((row) => row.date).filter(Boolean).sort();
  return {
    rowType: 'summary',
    rank: 0,
    date: dates.at(-1) ?? null,
    playerId: rows[0]?.playerId ?? null,
    opponent: teamRef.slug,
    map: 'all',
    kills,
    deaths,
    rating: ratingRows.length ? round(ratingRows.reduce((acc, row) => acc + row.rating, 0) / ratingRows.length) : null,
    result: `${wins}-${rows.length - wins}`,
    matchStatsId: 'all',
    details: {
      maps: rows.length,
      kdRatio: deaths > 0 ? round(kills / deaths) : null,
      plusMinusTotal: rows.reduce((acc, row) => acc + (row.plusMinus ?? 0), 0),
      firstDate: dates[0] ?? null,
      lastDate: dates.at(-1) ?? null,
      targetTeam: `${teamRef.teamId}/${teamRef.slug}`,
      nickname: rows[0]?.details?.nickname ?? null,
    },
  };
}

cli({
  site: 'hltv',
  name: 'player-vs-team',
  description: 'Filter a player matches page to maps played against a specific HLTV team',
  access: 'read',
  example: 'opencli hltv player-vs-team 7020/spirit --player 3741/niko --limit 20 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'player', type: 'string', default: '3741/niko', help: 'Player ref: 3741/niko, player URL, or stats player URL' },
    { name: 'team', type: 'string', positional: true, required: true, help: 'Team ref: 7020/spirit, team URL, or stats team URL' },
    { name: 'period', type: 'string', default: 'all', help: 'all / lastMonth / last3Months / last6Months / last12Months / YYYY / YYYY-MM-DD:YYYY-MM-DD' },
    { name: 'eventType', type: 'string', default: 'all', help: 'all / majors / bigEvents / mvpEvents / lan / online' },
    { name: 'event', type: 'string', default: 'all', help: 'all / event id / /events/:id URL / stats URL with event=' },
    { name: 'ranking', type: 'string', default: 'all', help: 'all / top5 / top10 / top20 / top30 / top50' },
    { name: 'map', type: 'string', default: 'all', help: 'all / ancient / anubis / dust2 / inferno / mirage / nuke / overpass / cache / cobblestone / season / train / tuscan / vertigo' },
    { name: 'version', type: 'string', default: 'both', help: 'both / cs2 / csgo' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset; must be a multiple of 100' },
    { name: 'limit', type: 'int', default: 100, help: 'Rows to scan from the current page (max 100)' },
  ],
  columns: ['rowType', 'rank', 'date', 'playerId', 'opponent', 'map', 'kills', 'deaths', 'rating', 'result', 'matchStatsId', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    const teamRef = parseTeamRef(args.team);
    const wanted = norm(teamRef.slug);
    const rows = (await readPlayerMatches(page, args, limit)).filter((row) => {
      return norm(row.opponent).includes(wanted) || wanted.includes(norm(row.opponent));
    });
    if (rows.length === 0) {
      throw new EmptyResultError('hltv player-vs-team', `No player match rows matched team ${teamRef.teamId}/${teamRef.slug}`);
    }
    return [
      summarize(rows, teamRef),
      ...rows.map((row) => ({
        rowType: 'map',
        rank: row.rank,
        date: row.date,
        playerId: row.playerId,
        opponent: row.opponent,
        map: row.map,
        kills: row.kills,
        deaths: row.deaths,
        rating: row.rating,
        result: row.details?.result ?? null,
        matchStatsId: row.matchStatsId,
        details: row.details,
      })),
    ];
  },
});
