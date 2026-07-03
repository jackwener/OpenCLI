import { ArgumentError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';

export const BASE = 'https://www.hltv.org';

function isHltvHost(hostname) {
  return hostname === 'hltv.org' || hostname === 'www.hltv.org';
}

function parseHltvUserUrl(raw, label) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ArgumentError(`${label} must be a valid hltv.org URL`);
  }
  if (!isHltvHost(url.hostname)) {
    throw new ArgumentError(`${label} must be an hltv.org URL`);
  }
  return url;
}

export const EVENT_TYPES = {
  all: null,
  majors: 'Majors',
  bigEvents: 'BigEvents',
  mvpEvents: 'MvpEvents',
  lan: 'Lan',
  online: 'Online',
};

export const RANKING_FILTERS = {
  all: null,
  top5: 'Top5',
  top10: 'Top10',
  top20: 'Top20',
  top30: 'Top30',
  top50: 'Top50',
};

export const MAPS = {
  all: null,
  ancient: 'de_ancient',
  anubis: 'de_anubis',
  dust2: 'de_dust2',
  inferno: 'de_inferno',
  mirage: 'de_mirage',
  nuke: 'de_nuke',
  overpass: 'de_overpass',
  cache: 'de_cache',
  cobblestone: 'de_cobblestone',
  season: 'de_season',
  train: 'de_train',
  tuscan: 'de_tuscan',
  vertigo: 'de_vertigo',
};

export const VERSIONS = {
  both: null,
  cs2: 'CS2',
  csgo: 'CSGO',
};

export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${label} must be a positive integer`);
  if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
  return n;
}

export function normalizeOffset(value, defaultValue = 0) {
  const raw = value ?? defaultValue;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ArgumentError('offset must be a non-negative integer');
  if (n % 100 !== 0) throw new ArgumentError('offset must be a multiple of 100');
  return n;
}

export function normalizeChoice(value, defaultValue, choices, label) {
  const raw = String(value ?? defaultValue);
  if (!Object.prototype.hasOwnProperty.call(choices, raw)) {
    throw new ArgumentError(`${label} must be one of: ${Object.keys(choices).join(', ')}`);
  }
  return raw;
}

export function parseNumber(value) {
  const raw = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!raw || raw === '-' || raw.toLowerCase() === 'n/a') return null;
  const match = raw.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

export function parseMoneyUsd(value) {
  return parseNumber(String(value ?? '').replace(/\$/g, ''));
}

export function absolutizeUrl(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value, BASE);
  } catch {
    throw new CommandExecutionError('HLTV parser returned a malformed URL');
  }
  if (!isHltvHost(url.hostname)) {
    throw new CommandExecutionError(`HLTV parser returned an off-domain URL: ${url.toString()}`);
  }
  return url.toString();
}

export function extractIdFromUrl(url, kind) {
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url, BASE);
  } catch {
    return null;
  }
  if (!isHltvHost(parsed.hostname)) return null;
  const path = parsed.pathname;
  const patterns = {
    player: /^\/player\/(\d+)\//,
    team: /^\/team\/(\d+)\//,
    event: /^\/events\/(\d+)\//,
    article: /^\/news\/(\d+)\//,
    matchStats: /^\/stats\/matches\/mapstatsid\/(\d+)\//,
    statsSeries: /^\/stats\/matches\/(\d+)\//,
    match: /^\/matches\/(\d+)\//,
  };
  const match = path.match(patterns[kind]);
  return match ? match[1] : null;
}

export function parseEventRef(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw === 'all') return null;
  if (/^\d+$/.test(raw)) return raw;

  let url = null;
  if (/^https?:\/\//i.test(raw)) url = parseHltvUserUrl(raw, 'event');
  if (url?.searchParams.get('event')) {
    const eventId = url.searchParams.get('event');
    if (/^\d+$/.test(eventId)) return eventId;
    throw new ArgumentError('event query parameter must be a numeric event id');
  }

  const path = (url ? url.pathname : raw).replace(/^\/+/, '');
  const eventPath = path.match(/^events\/(\d+)\//i);
  if (eventPath) return eventPath[1];

  throw new ArgumentError('event must be an event id, an /events/:id URL, a stats URL with event=, or all');
}

export function parseTeamRef(value, defaultValue = null) {
  const raw = String(value ?? defaultValue ?? '').trim();
  if (!raw) throw new ArgumentError('team is required');

  let path = raw;
  if (/^https?:\/\//i.test(raw)) path = parseHltvUserUrl(raw, 'team').pathname;
  path = path.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');

  const statsMatch = path.match(/^stats\/teams(?:\/matches)?\/(\d+)\/([a-z0-9-]+)/i);
  const teamMatch = path.match(/^team\/(\d+)\/([a-z0-9-]+)/i);
  const compactMatch = path.match(/^(\d+)\/([a-z0-9-]+)$/i);
  const match = statsMatch || teamMatch || compactMatch;
  if (!match) {
    throw new ArgumentError('team must be like 6667/falcons, a team URL, or a stats team URL');
  }

  return { teamId: match[1], slug: match[2].toLowerCase() };
}

export function parsePlayerRef(value, defaultValue = '3741/niko') {
  const raw = String(value ?? defaultValue).trim();
  if (!raw) throw new ArgumentError('player is required');

  let path = raw;
  if (/^https?:\/\//i.test(raw)) path = parseHltvUserUrl(raw, 'player').pathname;
  path = path.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/+/, '');

  const statsMatch = path.match(/^stats\/players(?:\/matches)?\/(\d+)\/([a-z0-9-]+)/i);
  const playerMatch = path.match(/^player\/(\d+)\/([a-z0-9-]+)/i);
  const compactMatch = path.match(/^(\d+)\/([a-z0-9-]+)$/i);
  const match = statsMatch || playerMatch || compactMatch;
  if (!match) {
    throw new ArgumentError('player must be like 3741/niko, a player URL, or a stats player URL');
  }

  return { playerId: match[1], slug: match[2].toLowerCase() };
}

function formatDate(date) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addMonths(date, months) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCMonth(copy.getUTCMonth() + months);
  return copy;
}

export function resolvePeriod(period) {
  const raw = String(period ?? 'all').trim();
  if (raw === 'all') return null;

  const now = new Date();
  if (raw === 'lastMonth') return { startDate: formatDate(addMonths(now, -1)), endDate: formatDate(now) };
  if (raw === 'last3Months') return { startDate: formatDate(addMonths(now, -3)), endDate: formatDate(now) };
  if (raw === 'last6Months') return { startDate: formatDate(addMonths(now, -6)), endDate: formatDate(now) };
  if (raw === 'last12Months') return { startDate: formatDate(addMonths(now, -12)), endDate: formatDate(now) };
  if (/^\d{4}$/.test(raw)) return { startDate: `${raw}-01-01`, endDate: `${raw}-12-31` };
  if (/^\d{4}-\d{2}-\d{2}:\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [startDate, endDate] = raw.split(':');
    return { startDate, endDate };
  }

  throw new ArgumentError('period must be all, lastMonth, last3Months, last6Months, last12Months, a year like 2025, or YYYY-MM-DD:YYYY-MM-DD');
}

export function buildPlayerUrl(player) {
  const { playerId, slug } = parsePlayerRef(player);
  return new URL(`/player/${playerId}/${slug}`, BASE);
}

export function buildPlayerMatchesUrl(args) {
  const { playerId, slug } = parsePlayerRef(args.player);
  const eventType = normalizeChoice(args.eventType, 'all', EVENT_TYPES, 'eventType');
  const ranking = normalizeChoice(args.ranking, 'all', RANKING_FILTERS, 'ranking');
  const map = normalizeChoice(args.map, 'all', MAPS, 'map');
  const version = normalizeChoice(args.version, 'both', VERSIONS, 'version');
  const offset = normalizeOffset(args.offset, 0);
  const period = String(args.period ?? 'all');
  const event = parseEventRef(args.event);

  const url = new URL(`/stats/players/matches/${playerId}/${slug}`, BASE);
  const range = resolvePeriod(period);
  if (range) {
    url.searchParams.set('startDate', range.startDate);
    url.searchParams.set('endDate', range.endDate);
  } else {
    url.searchParams.set('startDate', 'all');
  }
  if (EVENT_TYPES[eventType]) url.searchParams.set('matchType', EVENT_TYPES[eventType]);
  if (RANKING_FILTERS[ranking]) url.searchParams.set('rankingFilter', RANKING_FILTERS[ranking]);
  if (MAPS[map]) url.searchParams.set('maps', MAPS[map]);
  if (VERSIONS[version]) url.searchParams.set('csVersion', VERSIONS[version]);
  if (event) url.searchParams.set('event', event);
  if (offset > 0) url.searchParams.set('offset', String(offset));

  return { url, playerId, slug, filters: { period, eventType, event: event ?? 'all', ranking, map, version, offset } };
}

export function buildTeamMatchesUrl(args) {
  const { teamId, slug } = parseTeamRef(args.team);
  const eventType = normalizeChoice(args.eventType, 'all', EVENT_TYPES, 'eventType');
  const ranking = normalizeChoice(args.ranking, 'all', RANKING_FILTERS, 'ranking');
  const map = normalizeChoice(args.map, 'all', MAPS, 'map');
  const version = normalizeChoice(args.version, 'both', VERSIONS, 'version');
  const offset = normalizeOffset(args.offset, 0);
  const period = String(args.period ?? 'all');
  const event = parseEventRef(args.event);

  const url = new URL(`/team/${teamId}/${slug}`, BASE);
  const range = resolvePeriod(period);
  if (range) {
    url.searchParams.set('startDate', range.startDate);
    url.searchParams.set('endDate', range.endDate);
  } else {
    url.searchParams.set('startDate', 'all');
  }
  if (EVENT_TYPES[eventType]) url.searchParams.set('matchType', EVENT_TYPES[eventType]);
  if (RANKING_FILTERS[ranking]) url.searchParams.set('rankingFilter', RANKING_FILTERS[ranking]);
  if (MAPS[map]) url.searchParams.set('maps', MAPS[map]);
  if (VERSIONS[version]) url.searchParams.set('csVersion', VERSIONS[version]);
  if (event) url.searchParams.set('event', event);
  if (offset > 0) url.searchParams.set('offset', String(offset));

  return { url, teamId, slug, filters: { period, eventType, event: event ?? 'all', ranking, map, version, offset } };
}

function rowResult(teamScore, opponentScore) {
  if (teamScore === null || opponentScore === null) return null;
  if (teamScore > opponentScore) return 'win';
  if (teamScore < opponentScore) return 'loss';
  return 'draw';
}

export async function readPlayerMatches(page, args, limit) {
  const { url, playerId, slug, filters } = buildPlayerMatchesUrl(args);

  await gotoAndWait(page, url, '.stats-player-matches .stats-matches-table', 'hltv player matches page');

  const rows = await page.evaluate((payload) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const parseScoreName = (value) => {
      const raw = clean(value);
      const match = raw.match(/^(.*?)\s*\((\d+)\)$/);
      if (!match) return { name: raw, score: null };
      return { name: match[1].trim(), score: Number(match[2]) };
    };
    const numberFrom = (value) => {
      const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const nickname = clean(document.querySelector('.context-item-name, .summaryShortInfo .context-item-name')?.textContent)
      || clean(document.querySelector('.stats-profile-name, .playerNickname')?.textContent)
      || payload.slug;
    const filtersText = Object.entries(payload.filters).map(([key, value]) => `${key}=${value}`).join(',');
    const out = [];

    for (const tr of document.querySelectorAll('.stats-matches-table tr.group-1, .stats-matches-table tr.group-2')) {
      if (out.length >= payload.limit) break;
      const cells = [...tr.children];
      if (cells.length < 7) continue;
      const dateLink = cells[0].querySelector('a[href]');
      const matchStatsUrl = dateLink ? new URL(dateLink.getAttribute('href'), payload.base).toString() : null;
      const playerTeam = parseScoreName(cells[1].innerText);
      const opponent = parseScoreName(cells[2].innerText);
      const killsDeaths = clean(cells[4].innerText).match(/(\d+)\s*-\s*(\d+)/);
      const plusMinus = numberFrom(cells[5].innerText);
      const rating = numberFrom(cells[6].innerText);
      const result = playerTeam.score === null || opponent.score === null
        ? null
        : playerTeam.score > opponent.score ? 'win' : playerTeam.score < opponent.score ? 'loss' : 'draw';

      out.push({
        rank: payload.offset + out.length + 1,
        date: clean(cells[0].innerText),
        playerTeam: playerTeam.name,
        playerTeamScore: playerTeam.score,
        opponent: opponent.name,
        opponentScore: opponent.score,
        map: clean(cells[3].innerText),
        kills: killsDeaths ? Number(killsDeaths[1]) : null,
        deaths: killsDeaths ? Number(killsDeaths[2]) : null,
        plusMinus,
        rating,
        result,
        matchStatsId: matchStatsUrl ? (new URL(matchStatsUrl).pathname.match(/mapstatsid\/(\d+)\//)?.[1] ?? null) : null,
        matchStatsUrl,
        playerId: payload.playerId,
        nickname,
        filters: filtersText,
      });
    }
    return out;
  }, { base: BASE, playerId, slug, filters, limit, offset: filters.offset });

  return assertRequiredFields(rows.map((row) => ({
    rank: row.rank,
    date: parseHltvDate(row.date),
    playerTeam: row.playerTeam,
    opponent: row.opponent,
    map: row.map,
    kills: parseNumber(row.kills),
    deaths: parseNumber(row.deaths),
    plusMinus: parseNumber(row.plusMinus),
    rating: parseNumber(row.rating),
    playerId: row.playerId,
    matchStatsId: row.matchStatsId ?? extractIdFromUrl(row.matchStatsUrl, 'matchStats'),
    details: {
      result: row.result,
      playerTeamScore: parseNumber(row.playerTeamScore),
      opponentScore: parseNumber(row.opponentScore),
      matchStatsUrl: row.matchStatsUrl,
      nickname: row.nickname,
      filters: row.filters,
    },
  })), 'hltv player-matches', ['rank', 'date', 'playerTeam', 'opponent', 'map', 'playerId', 'matchStatsId']);
}

export async function readTeamMatches(page, args, limit) {
  const { url, teamId, slug, filters } = buildTeamMatchesUrl(args);

  await gotoAndWait(page, url, '.team-row, .match-table', 'hltv team profile matches page');

  const rows = await page.evaluate((payload) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const teamName = clean(document.querySelector('.profile-team-name, .teamName, .context-item-name')?.textContent)
      || payload.slug;
    const filtersText = Object.entries(payload.filters).map(([key, value]) => `${key}=${value}`).join(',');
    const out = [];

    for (const tr of document.querySelectorAll('tr.team-row')) {
      if (out.length >= payload.limit) break;
      const text = clean(tr.innerText);
      if (text.includes('-:-')) continue;
      const link = tr.querySelector('a[href*="/matches/"]');
      const matchUrl = link ? new URL(link.getAttribute('href'), payload.base).toString() : null;
      const score = text.match(/\s(\d+)\s*:\s*(\d+)\s/);
      if (!score) continue;
      const before = text.slice(0, score.index).trim();
      const after = text.slice(score.index + score[0].length).replace(/\bMatch\b.*$/, '').trim();
      const date = (before.match(/\d{2}\/\d{2}\/\d{4}/)?.[0]) ?? (before.match(/\d{2}:\d{2}/)?.[0]) ?? '';
      const teamText = before.replace(date, '').trim() || teamName;
      const opponent = after || clean(link?.textContent);
      const teamScore = Number(score[1]);
      const opponentScore = Number(score[2]);
      out.push({
        rank: payload.offset + out.length + 1,
        date,
        team: teamText || teamName,
        teamScore,
        opponent,
        opponentScore,
        map: 'series',
        event: null,
        roundDiff: teamScore === null || opponentScore === null ? null : teamScore - opponentScore,
        matchId: matchUrl ? (new URL(matchUrl).pathname.match(/\/matches\/(\d+)\//)?.[1] ?? null) : null,
        matchUrl,
        teamId: payload.teamId,
        teamName,
        filters: filtersText,
      });
    }
    return out;
  }, { base: BASE, teamId, slug, filters, limit, offset: filters.offset });

  return assertRequiredFields(rows.map((row) => ({
    rank: row.rank,
    date: parseHltvDate(row.date),
    team: row.teamName || row.team,
    opponent: row.opponent,
    map: row.map,
    result: rowResult(parseNumber(row.teamScore), parseNumber(row.opponentScore)),
    teamId: row.teamId,
    matchStatsId: row.matchId,
    details: {
      teamScore: parseNumber(row.teamScore),
      opponentScore: parseNumber(row.opponentScore),
      event: row.event,
      roundDiff: parseNumber(row.roundDiff),
      matchUrl: row.matchUrl,
      filters: row.filters,
    },
  })), 'hltv team-matches', ['rank', 'date', 'team', 'opponent', 'teamId', 'matchStatsId']);
}

export function parseHltvDate(value) {
  const raw = String(value ?? '').trim();
  const shortMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (shortMatch) {
    const [, dd, mm, yy] = shortMatch;
    return `20${yy}-${mm}-${dd}`;
  }
  const longMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (longMatch) {
    const [, dd, mm, yyyy] = longMatch;
    return `${yyyy}-${mm}-${dd}`;
  }
  return raw;
}

export function normalizeMatchUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new ArgumentError('match is required');
  const url = /^https?:\/\//i.test(raw) ? parseHltvUserUrl(raw, 'match') : new URL(raw.replace(/^\/+/, ''), `${BASE}/`);
  if (!/^\/(?:matches\/\d+\/|stats\/matches\/(?:mapstatsid\/)?\d+\/)/.test(url.pathname)) {
    throw new ArgumentError('match must be an HLTV match, stats series, or mapstats URL');
  }
  return url;
}

function buildPerformanceUrl(mapstatsUrl) {
  const url = new URL(mapstatsUrl, BASE);
  url.pathname = url.pathname.replace('/stats/matches/mapstatsid/', '/stats/matches/performance/mapstatsid/');
  return url;
}

export async function resolveMatchMapUrls(page, match) {
  const url = normalizeMatchUrl(match);
  if (/^\/stats\/matches\/mapstatsid\/\d+\//.test(url.pathname)) return [url.toString()];

  await gotoAndWait(page, url, 'a[href*="/stats/matches/mapstatsid/"]', 'hltv match map link page');
  const links = await page.evaluate((payload) => {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href*="/stats/matches/mapstatsid/"]')) {
      const href = new URL(a.getAttribute('href'), payload.base);
      href.search = '';
      href.hash = '';
      const key = href.pathname.match(/mapstatsid\/(\d+)\//)?.[1];
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(href.toString());
    }
    return out;
  }, { base: BASE });
  return assertRows(links, 'hltv match map urls');
}

export async function resolveStatsSeriesUrlFromMap(page, mapstatsUrl) {
  const url = normalizeMatchUrl(mapstatsUrl);
  if (!/^\/stats\/matches\/mapstatsid\/\d+\//.test(url.pathname)) {
    throw new ArgumentError('series resolution requires a /stats/matches/mapstatsid/:id/:slug URL');
  }

  await gotoAndWait(page, url, 'a[href*="/stats/matches/"]', 'hltv match series link page');
  const seriesUrl = await page.evaluate((payload) => {
    for (const a of document.querySelectorAll('a[href*="/stats/matches/"]')) {
      const href = new URL(a.getAttribute('href'), payload.base);
      href.search = '';
      href.hash = '';
      if (/^\/stats\/matches\/\d+\//.test(href.pathname)) return href.toString();
    }
    return null;
  }, { base: BASE });

  return seriesUrl ?? url.toString();
}

export async function readMatchMap(page, match) {
  const url = normalizeMatchUrl(match);
  if (!/^\/stats\/matches\/mapstatsid\/\d+\//.test(url.pathname)) {
    throw new ArgumentError('match map parser requires a /stats/matches/mapstatsid/:id/:slug URL');
  }
  const matchStatsId = extractIdFromUrl(url.toString(), 'matchStats');

  await gotoAndWait(page, url, '.stats-section.stats-match, .stats-table.totalstats', 'hltv match map page');

  const rows = await page.evaluate((payload) => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const cleanLines = (value) => String(value ?? '').split('\n').map((line) => clean(line)).filter(Boolean);
    const numberFrom = (value) => {
      const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
      return match ? Number(match[0]) : null;
    };
    const textOf = (root, selector) => clean(root.querySelector(selector)?.textContent);
    const splitMainParen = (value) => {
      const match = clean(value).match(/^(-?\d+(?:\.\d+)?)\s*(?:\(([-\d.]+)\))?/);
      return { main: match ? Number(match[1]) : null, paren: match?.[2] !== undefined ? Number(match[2]) : null };
    };
    const infoLines = cleanLines(document.querySelector('.match-info-box')?.innerText);
    const dateIndex = infoLines.findIndex((line) => /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(line));
    const event = dateIndex > 0 ? infoLines.slice(0, dateIndex).join(' ') : null;
    const dateTime = dateIndex >= 0 ? infoLines[dateIndex] : null;
    const mapLabelIndex = infoLines.indexOf('Map');
    const selectedMap = mapLabelIndex >= 0 ? infoLines[mapLabelIndex + 1] : null;
    const scoreStart = mapLabelIndex >= 0 ? mapLabelIndex + 2 : -1;
    const teamOne = scoreStart >= 0 ? infoLines[scoreStart] : null;
    const teamOneScore = scoreStart >= 0 ? numberFrom(infoLines[scoreStart + 1]) : null;
    const teamTwo = scoreStart >= 0 ? infoLines[scoreStart + 2] : null;
    const teamTwoScore = scoreStart >= 0 ? numberFrom(infoLines[scoreStart + 3]) : null;
    const rows = [];
    let currentTeam = null;

    for (const tr of document.querySelectorAll('.stats-table.totalstats tr')) {
      const teamName = textOf(tr, '.st-teamname');
      if (teamName) {
        currentTeam = teamName;
        continue;
      }

      const playerLink = tr.querySelector('a[href^="/stats/players/"], a[href*="/stats/players/"], a[href^="/player/"], a[href*="/player/"]');
      if (!playerLink || !currentTeam) continue;
      const playerUrl = new URL(playerLink.getAttribute('href'), payload.base).toString();
      const playerId = new URL(playerUrl).pathname.match(/\/(?:stats\/players|player)\/(\d+)\//)?.[1] ?? null;
      const kills = splitMainParen(textOf(tr, '.st-kills'));
      const assists = splitMainParen(textOf(tr, '.st-assists'));
      const deaths = splitMainParen(textOf(tr, '.st-deaths'));
      const opponent = currentTeam === teamOne ? teamTwo : teamOne;

      rows.push({
        matchStatsId: payload.matchStatsId,
        playerId,
        playerName: clean(playerLink.textContent),
        team: currentTeam,
        kills: kills.main,
        deaths: deaths.main,
        adr: numberFrom(textOf(tr, '.st-adr')),
        kastPct: numberFrom(textOf(tr, '.st-kast')),
        rating: numberFrom(textOf(tr, '.st-rating')),
        opKd: textOf(tr, '.st-opkd'),
        details: {
          map: selectedMap,
          event,
          dateTime,
          teamScore: currentTeam === teamOne ? teamOneScore : teamTwoScore,
          opponent,
          opponentScore: currentTeam === teamOne ? teamTwoScore : teamOneScore,
          headshots: kills.paren,
          assists: assists.main,
          flashAssists: assists.paren,
          tradedDeaths: deaths.paren,
          multiKills: numberFrom(textOf(tr, '.st-mks')),
          clutches: numberFrom(textOf(tr, '.st-clutches')),
          roundSwingPct: numberFrom(textOf(tr, '.st-roundSwing')),
        },
        url: playerUrl,
      });
    }
    return rows;
  }, { base: BASE, matchStatsId });

  if (!Array.isArray(rows)) throw new CommandExecutionError('hltv match-map parser returned an unexpected shape');
  if (rows.length === 0) throw new CommandExecutionError('hltv match-map parser found no player rows');

  return assertRequiredFields(rows.map((row) => ({
    matchStatsId: row.matchStatsId,
    playerId: row.playerId,
    playerName: row.playerName,
    team: row.team,
    kills: parseNumber(row.kills),
    deaths: parseNumber(row.deaths),
    adr: parseNumber(row.adr),
    kastPct: parseNumber(row.kastPct),
    rating: parseNumber(row.rating),
    opKd: row.opKd,
    details: row.details,
    url: row.url,
  })), 'hltv match-map', ['matchStatsId', 'playerId', 'playerName', 'team', 'url']);
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function summarizePlayers(mapRows) {
  const byTeam = new Map();
  for (const row of mapRows) {
    if (!byTeam.has(row.team)) {
      byTeam.set(row.team, {
        team: row.team,
        opponent: row.details?.opponent ?? null,
        maps: 0,
        kills: 0,
        deaths: 0,
        ratingSum: 0,
        ratingCount: 0,
        players: 0,
        scores: [],
      });
    }
    const bucket = byTeam.get(row.team);
    bucket.players += 1;
    bucket.kills += row.kills ?? 0;
    bucket.deaths += row.deaths ?? 0;
    if (Number.isFinite(row.rating)) {
      bucket.ratingSum += row.rating;
      bucket.ratingCount += 1;
    }
    if (Number.isFinite(row.details?.teamScore)) bucket.scores.push(row.details.teamScore);
  }
  return [...byTeam.values()].map((bucket) => ({
    team: bucket.team,
    opponent: bucket.opponent,
    kills: bucket.kills,
    deaths: bucket.deaths,
    avgRating: bucket.ratingCount ? round(bucket.ratingSum / bucket.ratingCount) : null,
    score: bucket.scores[0] ?? null,
  }));
}

export async function readMatchSeries(page, match) {
  const mapUrls = await resolveMatchMapUrls(page, match);
  const outRows = [];
  const mapSummaries = [];
  const seriesTotals = new Map();
  let firstMeta = null;

  for (const mapUrl of mapUrls) {
    const mapRows = await readMatchMap(page, mapUrl);
    const first = mapRows[0];
    if (!firstMeta) firstMeta = first?.details ?? null;
    const teams = summarizePlayers(mapRows);
    const mapName = first?.details?.map ?? null;
    const date = first?.details?.dateTime?.slice(0, 10) ?? null;
    const event = first?.details?.event ?? null;
    const teamLine = teams.map((team) => `${team.team} ${team.score ?? ''}`.trim()).join(' vs ');

    mapSummaries.push({
      matchStatsId: first?.matchStatsId ?? extractIdFromUrl(mapUrl, 'matchStats'),
      map: mapName,
      date,
      event,
      score: teamLine,
      url: mapUrl,
      teams,
    });

    for (const team of teams) {
      if (!seriesTotals.has(team.team)) {
        seriesTotals.set(team.team, {
          team: team.team,
          opponent: team.opponent,
          maps: 0,
          mapWins: 0,
          kills: 0,
          deaths: 0,
          ratingSum: 0,
          ratingCount: 0,
        });
      }
      const total = seriesTotals.get(team.team);
      total.maps += 1;
      total.mapWins += teams.length > 1 && team.score > (teams.find((other) => other.team !== team.team)?.score ?? -1) ? 1 : 0;
      total.kills += team.kills;
      total.deaths += team.deaths;
      if (Number.isFinite(team.avgRating)) {
        total.ratingSum += team.avgRating;
        total.ratingCount += 1;
      }
    }

    for (const team of teams) {
      outRows.push({
        rowType: 'map',
        date,
        event,
        map: mapName,
        team: team.team,
        opponent: team.opponent,
        score: team.score === null ? null : `${team.score}-${teams.find((other) => other.team !== team.team)?.score ?? ''}`,
        matchStatsId: first?.matchStatsId ?? extractIdFromUrl(mapUrl, 'matchStats'),
        playerId: null,
        playerName: null,
        rating: team.avgRating,
        details: {
          kills: team.kills,
          deaths: team.deaths,
          kdRatio: team.deaths > 0 ? round(team.kills / team.deaths) : null,
          mapStatsUrl: mapUrl,
        },
      });
    }

    for (const row of mapRows) {
      outRows.push({
        rowType: 'player',
        date: row.details?.dateTime?.slice(0, 10) ?? null,
        event: row.details?.event ?? null,
        map: row.details?.map ?? null,
        team: row.team,
        opponent: row.details?.opponent ?? null,
        score: row.details?.teamScore === null ? null : `${row.details?.teamScore}-${row.details?.opponentScore}`,
        matchStatsId: row.matchStatsId,
        playerId: row.playerId,
        playerName: row.playerName,
        rating: row.rating,
        details: {
          kills: row.kills,
          deaths: row.deaths,
          adr: row.adr,
          kastPct: row.kastPct,
          opKd: row.opKd,
          headshots: row.details?.headshots ?? null,
          assists: row.details?.assists ?? null,
          flashAssists: row.details?.flashAssists ?? null,
          tradedDeaths: row.details?.tradedDeaths ?? null,
          mapStatsUrl: mapUrl,
          playerUrl: row.url,
        },
      });
    }
  }

  const summaryDetails = {
    maps: mapUrls.length,
    event: firstMeta?.event ?? null,
    firstDate: mapSummaries.map((row) => row.date).filter(Boolean).sort()[0] ?? null,
    lastDate: mapSummaries.map((row) => row.date).filter(Boolean).sort().at(-1) ?? null,
    mapStatsIds: mapSummaries.map((row) => row.matchStatsId).join(','),
    mapsPlayed: mapSummaries.map((row) => row.map).filter(Boolean).join(','),
    mapScores: mapSummaries.map((row) => `${row.map}:${row.score}`).join('; '),
  };
  const summaryRows = [...seriesTotals.values()].map((team) => ({
    rowType: 'summary',
    date: summaryDetails.lastDate,
    event: summaryDetails.event,
    map: 'all',
    team: team.team,
    opponent: team.opponent,
    score: `${team.mapWins}-${team.maps - team.mapWins}`,
    matchStatsId: 'all',
    playerId: null,
    playerName: null,
    rating: team.ratingCount ? round(team.ratingSum / team.ratingCount) : null,
    details: {
      ...summaryDetails,
      mapsWon: team.mapWins,
      mapsLost: team.maps - team.mapWins,
      kills: team.kills,
      deaths: team.deaths,
      kdRatio: team.deaths > 0 ? round(team.kills / team.deaths) : null,
    },
  }));

  return assertRows([...summaryRows, ...outRows], 'hltv match-series');
}

export async function readPerformanceKillMatrix(page, mapstatsUrl) {
  const url = buildPerformanceUrl(mapstatsUrl);
  await gotoAndWait(page, url, '.stats-table', 'hltv match performance page');

  const matrix = await page.evaluate(() => {
    const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
    const parseCell = (value) => {
      const match = clean(value).match(/^(\d+)\s*:\s*(\d+)$/);
      return match ? { left: Number(match[1]), right: Number(match[2]) } : null;
    };
    const table = [...document.querySelectorAll('table.stats-table')].find((candidate) => {
      const text = clean(candidate.innerText);
      return /\d+\s*:\s*\d+/.test(text);
    });
    if (!table) return null;
    const trs = [...table.querySelectorAll('tr')];
    const headerCells = [...trs[0]?.children ?? []].map((cell) => clean(cell.textContent)).filter(Boolean);
    const entries = [];
    for (const tr of trs.slice(1)) {
      const cells = [...tr.children].map((cell) => clean(cell.textContent));
      const rowPlayer = cells[0];
      if (!rowPlayer) continue;
      for (let i = 1; i < cells.length; i += 1) {
        const parsed = parseCell(cells[i]);
        const colPlayer = headerCells[i - 1];
        if (!parsed || !colPlayer) continue;
        entries.push({
          rowPlayer,
          colPlayer,
          rowKillsCol: parsed.left,
          colKillsRow: parsed.right,
        });
      }
    }
    return entries;
  });

  if (!Array.isArray(matrix)) return [];
  return matrix;
}

export async function gotoAndWait(page, url, selector, label) {
  try {
    await page.goto(url.toString(), { waitUntil: 'domcontentloaded', settleMs: 1000, timeout: 20000 });
    await page.wait({ selector, timeout: 15000 });
  } catch (error) {
    if (/timeout/i.test(String(error?.message ?? error))) {
      throw new TimeoutError(label, 15);
    }
    throw new CommandExecutionError(`${label} failed: ${error?.message ?? error}`);
  }
}

export function assertRows(rows, command) {
  if (!Array.isArray(rows)) throw new CommandExecutionError(`${command} parser returned an unexpected shape`);
  if (rows.length === 0) throw new EmptyResultError(command, 'No rows were found in the visible HLTV page');
  return rows;
}

export function assertRequiredFields(rows, command, fields) {
  assertRows(rows, command);
  for (const [index, row] of rows.entries()) {
    for (const field of fields) {
      if (row?.[field] === null || row?.[field] === undefined || row?.[field] === '') {
        throw new CommandExecutionError(`${command} parser returned row ${index + 1} without required ${field}`);
      }
    }
  }
  return rows;
}
