import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, gotoAndWait, parseNumber, parseTeamRef } from './utils.js';

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function splitRecord(value) {
  const match = String(value ?? '').match(/(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/);
  return match ? { wins: Number(match[1]), draws: Number(match[2]), losses: Number(match[3]) } : { wins: null, draws: null, losses: null };
}

cli({
  site: 'hltv',
  name: 'team-map-pool',
  description: 'Read the visible HLTV team map-pool page with win rate, pick rate, and ban rate',
  access: 'read',
  example: 'opencli hltv team-map-pool 11283/falcons -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'team', type: 'string', positional: true, required: true, help: 'Team ref: 11283/falcons, team URL, or stats team URL' },
  ],
  columns: ['category', 'key', 'teamId', 'team', 'maps', 'winMaps', 'lossMaps', 'winRatePct', 'avgRoundDiff', 'details'],
  func: async (page, args) => {
    const { teamId, slug } = parseTeamRef(args.team);
    await gotoAndWait(page, new URL(`/team/${teamId}/${slug}`, BASE), '.team-row, .profile-team-name, .teamName', 'hltv team profile warmup page');
    const url = new URL(`/stats/teams/maps/${teamId}/${slug}`, BASE);
    await gotoAndWait(page, url, '.map-pool-map-holder.map-stats, .two-grid .stats-row', 'hltv team map-pool page');

    const rawRows = await page.evaluate((payload) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const readMetric = (root, label) => {
        const row = [...root.querySelectorAll('.stats-row')].find((item) => clean(item.textContent).startsWith(label));
        return row ? clean(row.textContent).slice(label.length).trim() : null;
      };
      const team = clean(document.querySelector('.context-item-name, .profile-team-name, .teamName')?.textContent) || payload.slug;
      const byMap = new Map();
      for (const link of document.querySelectorAll('.map-pool-map-holder.map-stats')) {
        const text = clean(link.textContent);
        const match = text.match(/^(.+?)\s*-\s*([\d.]+)%$/);
        if (!match) continue;
        byMap.set(match[1].trim(), {
          category: 'map',
          key: match[1].trim(),
          teamId: payload.teamId,
          team,
          record: null,
          winRate: `${match[2]}%`,
          totalRounds: null,
          firstKillWinPct: null,
          firstDeathWinPct: null,
          pickPct: null,
          banPct: null,
          mapUrl: new URL(link.getAttribute('href'), payload.base).toString(),
        });
      }
      for (const grid of document.querySelectorAll('.two-grid')) {
        const mapName = clean(grid.querySelector('.map-pool-map-holder')?.textContent);
        if (!mapName) continue;
        const record = readMetric(grid, 'Wins / draws / losses');
        const winRate = readMetric(grid, 'Win rate');
        const totalRounds = readMetric(grid, 'Total rounds');
        const firstKillWinPct = readMetric(grid, 'Round win-% after getting first kill');
        const firstDeathWinPct = readMetric(grid, 'Round win-% after receiving first death');
        const pickPct = readMetric(grid, 'Pick %');
        const banPct = readMetric(grid, 'Ban %');
        if (!record && !winRate) continue;
        byMap.set(mapName, {
          category: 'map',
          key: mapName,
          teamId: payload.teamId,
          team,
          record,
          winRate,
          totalRounds,
          firstKillWinPct,
          firstDeathWinPct,
          pickPct,
          banPct,
          mapUrl: byMap.get(mapName)?.mapUrl ?? null,
        });
      }
      return [...byMap.values()];
    }, { base: BASE, teamId, slug });

    if (!Array.isArray(rawRows)) throw new CommandExecutionError('hltv team-map-pool parser returned an unexpected shape');
    if (rawRows.length === 0) throw new EmptyResultError('hltv team-map-pool', `No map-pool rows found for team ${teamId}/${slug}`);

    const rows = rawRows.map((row) => {
      const record = splitRecord(row.record);
      const maps = record.wins === null ? null : (record.wins ?? 0) + (record.draws ?? 0) + (record.losses ?? 0);
      return {
        category: row.category,
        key: row.key,
        teamId: row.teamId,
        team: row.team,
        maps,
        winMaps: record.wins,
        lossMaps: record.losses,
        winRatePct: parseNumber(row.winRate),
        avgRoundDiff: null,
        details: {
          draws: record.draws,
          totalRounds: parseNumber(row.totalRounds),
          roundsPerMap: maps ? round(parseNumber(row.totalRounds) / maps) : null,
          firstKillWinPct: parseNumber(row.firstKillWinPct),
          firstDeathWinPct: parseNumber(row.firstDeathWinPct),
          pickPct: parseNumber(row.pickPct),
          banPct: parseNumber(row.banPct),
          url: url.toString(),
        },
      };
    }).sort((a, b) => (b.maps ?? -1) - (a.maps ?? -1) || String(a.key).localeCompare(String(b.key)));

    const totals = rows.reduce((acc, row) => {
      acc.maps += row.maps ?? 0;
      acc.winMaps += row.winMaps ?? 0;
      acc.lossMaps += row.lossMaps ?? 0;
      return acc;
    }, { maps: 0, winMaps: 0, lossMaps: 0 });

    return [
      {
        category: 'summary',
        key: 'all',
        teamId,
        team: rows[0]?.team ?? slug,
        maps: totals.maps,
        winMaps: totals.winMaps,
        lossMaps: totals.lossMaps,
        winRatePct: totals.maps ? round((totals.winMaps / totals.maps) * 100) : null,
        avgRoundDiff: null,
        details: {
          mapsCovered: rows.length,
          source: url.toString(),
        },
      },
      ...rows,
    ];
  },
});
