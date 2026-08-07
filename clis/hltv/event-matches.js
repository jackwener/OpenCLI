import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, assertRequiredFields, extractIdFromUrl, gotoAndWait, normalizeLimit, parseEventRef, parseHltvDate, parseNumber } from './utils.js';

function buildEventStatsUrl(event) {
  const eventId = parseEventRef(event);
  if (!eventId) throw new ArgumentError('event is required and must be an event id or event URL');
  const pageUrl = new URL('/stats/matches', BASE);
  pageUrl.searchParams.set('event', eventId);
  const target = {};
  target.pageUrl = pageUrl;
  target.eventId = eventId;
  return target;
}

cli({
  site: 'hltv',
  name: 'event-matches',
  description: 'Read visible HLTV stats match rows for a specific event',
  access: 'read',
  example: 'opencli hltv event-matches 8301 --limit 10 -f json',
  domain: 'www.hltv.org',
  strategy: Strategy.UI,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'event', type: 'string', positional: true, required: true, help: 'Event id, /events/:id URL, or stats URL with event=' },
    { name: 'limit', type: 'int', default: 100, help: 'Rows to return from the visible stats matches table (max 100)' },
  ],
  columns: ['rank', 'date', 'eventId', 'team', 'opponent', 'score', 'map', 'matchStatsId', 'matchStatsUrl', 'details'],
  func: async (page, args) => {
    const limit = normalizeLimit(args.limit, 100, 100);
    const { pageUrl, eventId } = buildEventStatsUrl(args.event);
    await gotoAndWait(page, pageUrl, '.stats-matches-table, table.stats-table', 'hltv event matches page');

    const rawRows = await page.evaluate((payload) => {
      const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
      const parseScoreName = (value) => {
        const raw = clean(value);
        const match = raw.match(/^(.*?)\s*\((\d+)\)$/);
        if (!match) return { _label: raw, _score: null };
        return { _label: match[1].trim(), _score: Number(match[2]) };
      };
      const out = [];
      const rows = document.querySelectorAll('.stats-matches-table tr.group-1, .stats-matches-table tr.group-2, table.stats-table tr.group-1, table.stats-table tr.group-2');
      for (const tr of rows) {
        if (out.length >= payload.limit) break;
        const cells = [...tr.children];
        if (cells.length < 4) continue;
        const link = tr.querySelector('a[href*="/stats/matches/mapstatsid/"], a[href*="/stats/matches/"]');
        const matchStatsUrl = link ? new URL(link.getAttribute('href'), payload.base).toString() : null;
        const first = parseScoreName(cells[1]?.innerText);
        const second = parseScoreName(cells[2]?.innerText);
        const rawRow = {
          rank: out.length + 1,
          date: clean(cells[0]?.innerText),
          team: first._label,
          _teamScore: first._score,
          opponent: second._label,
          _opponentScore: second._score,
          map: clean(cells[3]?.innerText),
          matchStatsUrl,
          _extra: cells.slice(4).map((cell) => clean(cell.innerText)).filter(Boolean).join(' | '),
        };
        out.push(rawRow);
      }
      return out;
    }, { base: BASE, limit });

    if (!Array.isArray(rawRows)) throw new CommandExecutionError('hltv event-matches parser returned an unexpected shape');
    if (rawRows.length === 0) throw new EmptyResultError('hltv event-matches', `No stats match rows found for event ${eventId}`);

    return assertRequiredFields(rawRows.map((row) => ({
      rank: row.rank,
      date: parseHltvDate(row.date),
      eventId,
      team: row.team,
      opponent: row.opponent,
      score: row._teamScore === null ? null : `${row._teamScore}-${row._opponentScore}`,
      map: row.map,
      matchStatsId: extractIdFromUrl(row.matchStatsUrl, 'matchStats'),
      matchStatsUrl: row.matchStatsUrl,
      details: {
        teamScore: parseNumber(row._teamScore),
        opponentScore: parseNumber(row._opponentScore),
        extra: row._extra,
      },
    })), 'hltv event-matches', ['rank', 'date', 'eventId', 'team', 'opponent', 'matchStatsId', 'matchStatsUrl']);
  },
});
