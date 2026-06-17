import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const BASE_URL = 'https://www.huodongxing.com/events';
const MAX_LIMIT = 50;
export const EVENTS_COLUMNS = [
  'rank',
  'id',
  'title',
  'time',
  'eventType',
  'city',
  'location',
  'organizer',
  'url',
];

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function requireLimit(value) {
  const raw = value ?? 20;
  const limit = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new ArgumentError('huodongxing limit must be a positive integer');
  }
  if (limit > MAX_LIMIT) {
    throw new ArgumentError(`huodongxing limit must be <= ${MAX_LIMIT}`);
  }
  return limit;
}

function appendIfPresent(params, name, value) {
  const text = cleanText(value);
  if (text) params.set(name, text);
}

function dateOrdinal(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / 86400000);
}

function parseYmd(value) {
  const match = cleanText(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return dateOrdinal(year, month, day);
}

function requireYmdArg(value, label) {
  const text = cleanText(value);
  if (!text) return '';
  if (parseYmd(text) == null) {
    throw new ArgumentError(`huodongxing ${label} must be a valid YYYY-MM-DD date`);
  }
  return text;
}

function requireDateRangeArgs(args = {}) {
  const date = requireYmdArg(args.date, 'date');
  const dateTo = requireYmdArg(args.dateTo, 'dateTo');
  if (date && dateTo && parseYmd(date) > parseYmd(dateTo)) {
    throw new ArgumentError('huodongxing date must be <= dateTo');
  }
  return { date, dateTo };
}

function unwrapEvaluateResult(payload) {
  if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
    return payload.data;
  }
  return payload;
}

function localDateOrdinal(date) {
  return dateOrdinal(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function parseMonthDayToken(token, year) {
  const match = cleanText(token).match(/(\d{1,2})\/(\d{1,2})/);
  if (!match) return null;
  return {
    month: Number(match[1]),
    day: Number(match[2]),
    ordinal: dateOrdinal(year, Number(match[1]), Number(match[2])),
  };
}

function parseEventTimeRange(timeText, options = {}) {
  const text = cleanText(timeText);
  if (!text) return null;
  const filterStart = parseYmd(options.date);
  const filterEnd = parseYmd(options.dateTo) ?? filterStart;
  const referenceDate = options.referenceDate instanceof Date ? options.referenceDate : new Date();
  const referenceOrdinal = localDateOrdinal(referenceDate);
  if (/今天/.test(text)) return { start: referenceOrdinal, end: referenceOrdinal };
  if (/明天/.test(text)) return { start: referenceOrdinal + 1, end: referenceOrdinal + 1 };
  if (/后天/.test(text)) return { start: referenceOrdinal + 2, end: referenceOrdinal + 2 };

  const baseYear = options.year ?? (
    cleanText(options.date).match(/^(\d{4})-/)?.[1]
      ? Number(cleanText(options.date).slice(0, 4))
      : referenceDate.getFullYear()
  );
  const tokens = Array.from(text.matchAll(/(\d{1,2}\/\d{1,2})/g)).map((match) => match[1]);
  if (tokens.length === 0) return null;
  const start = parseMonthDayToken(tokens[0], baseYear);
  if (!start) return null;
  if (tokens.length === 1) return { start: start.ordinal, end: start.ordinal };
  const endYear = parseMonthDayToken(tokens[1], baseYear)?.month < start.month ? baseYear + 1 : baseYear;
  const end = parseMonthDayToken(tokens[1], endYear);
  if (!end) return { start: start.ordinal, end: start.ordinal };

  // If the parsed range is clearly before the requested window, try the next
  // year. Huodongxing listings omit the year, but searches can cross New Year.
  if (filterStart != null && end.ordinal < filterStart && start.month >= 10) {
    const nextStart = parseMonthDayToken(tokens[0], baseYear + 1);
    const nextEndYear = parseMonthDayToken(tokens[1], baseYear + 1)?.month < nextStart.month ? baseYear + 2 : baseYear + 1;
    const nextEnd = parseMonthDayToken(tokens[1], nextEndYear);
    if (nextStart && nextEnd) return { start: nextStart.ordinal, end: nextEnd.ordinal };
  }
  return { start: start.ordinal, end: end.ordinal };
}

export function filterRowsByDateRange(rows, options = {}) {
  requireDateRangeArgs(options);
  const filterStart = parseYmd(options.date);
  const filterEnd = parseYmd(options.dateTo) ?? filterStart;
  if (filterStart == null && filterEnd == null) return rows;
  const start = filterStart ?? filterEnd;
  const end = filterEnd ?? filterStart;
  const filtered = rows.filter((row) => {
    const range = parseEventTimeRange(row.time, options);
    if (!range) return true;
    return range.start <= end && range.end >= start;
  });
  return filtered.map((row, index) => ({ ...row, rank: index + 1 }));
}

export function buildEventsUrl(args = {}) {
  const dateRange = requireDateRangeArgs(args);
  const params = new URLSearchParams();
  params.set('orderby', 'o');
  params.set('d', 'ts');
  appendIfPresent(params, 'date', dateRange.date);
  appendIfPresent(params, 'dateTo', dateRange.dateTo);
  appendIfPresent(params, 'tag', args.tag);
  appendIfPresent(params, 'city', args.city);
  const eventType = cleanText(args.eventType);
  if (eventType) {
    if (eventType !== '1' && eventType !== '2') {
      throw new ArgumentError('huodongxing eventType must be 1 (offline) or 2 (online)');
    }
    params.set('eventType', eventType);
  }
  appendIfPresent(params, 'qs', args.qs);
  return `${BASE_URL}?${params.toString()}`;
}

export function extractEventRowsPayload(limit = 20) {
  const maxLimit = 50;
  const rawLimit = limit ?? 20;
  const count = typeof rawLimit === 'number' ? rawLimit : Number(String(rawLimit).trim());
  if (!Number.isInteger(count) || count <= 0 || count > maxLimit) {
    return {
      ok: false,
      code: 'INVALID_LIMIT',
      message: `huodongxing limit must be a positive integer <= ${maxLimit}`,
    };
  }
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const text = (root, selector) => clean(root.querySelector(selector)?.textContent ?? '');
  const idFromHref = (href) => {
    const match = String(href ?? '').match(/\/event\/(\d+)/);
    return match ? match[1] : '';
  };
  const eventUrl = (id) => `https://www.huodongxing.com/event/${id}`;
  const kind = (card, location) => {
    if (card.querySelector('.item-live-icon')) return 'online';
    if (card.querySelector('.item-dress-icon')) return 'offline';
    if (/线上|在线|直播/.test(location)) return 'online';
    return '';
  };
  const cards = Array.from(document.querySelectorAll('.search-tab-content-item-mesh'));
  const rows = [];
  const seen = new Set();

  for (const card of cards) {
    if (rows.length >= count) break;
    const link = card.querySelector('a.item-title[href*="/event/"], a[href*="/event/"]');
    const id = idFromHref(link?.getAttribute('href') ?? '');
    if (!id || seen.has(id)) continue;

    const title = clean(
      text(card, 'a.item-title span')
      || text(card, 'a.item-title')
      || card.querySelector('img.item-logo')?.getAttribute('alt')
      || '',
    );
    if (!title) continue;

    const time = text(card, '.item-dress p');
    const location = text(card, '.item-dress-pp');
    const organizer = clean(
      text(card, '.item-bottom-left .user-name')
      || card.querySelector('.item-bottom-left img[title]')?.getAttribute('title')
      || card.querySelector('.item-bottom-left img[alt]')?.getAttribute('alt')
      || '',
    );
    seen.add(id);
    rows.push({
      rank: rows.length + 1,
      id,
      title,
      time,
      eventType: kind(card, location),
      city: location,
      location,
      organizer,
      url: eventUrl(id),
    });
  }

  if (rows.length === 0) {
    const pageText = clean(document.body?.textContent ?? '');
    if (/操作过于频繁|too\s+frequent|rate\s*limit/i.test(pageText)) {
      return {
        ok: false,
        code: 'RATE_LIMIT',
        message: 'huodongxing events was rate limited by www.huodongxing.com',
        hint: 'Wait a few minutes and retry from a real browser session.',
      };
    }
    if (cards.length > 0) {
      return {
        ok: false,
        code: 'MALFORMED_RESULT',
        message: 'huodongxing events cards were found but no stable event rows could be extracted',
        hint: 'Huodongxing card markup changed: expected event links with /event/<id> and non-empty titles.',
      };
    }
    return {
      ok: false,
      code: 'EMPTY_RESULT',
      message: 'huodongxing events returned no data',
      hint: 'No Huodongxing event cards were found. The page may be empty or the DOM structure may have changed.',
    };
  }
  return { ok: true, rows };
}

function requireExtractionRows(result) {
  const payload = unwrapEvaluateResult(result);
  if (payload?.ok === true && Array.isArray(payload.rows)) return payload.rows;
  if (payload?.ok === true) {
    throw new CommandExecutionError(
      'huodongxing events returned malformed extraction rows',
      'Expected browser extraction payload rows to be an array.',
    );
  }
  if (payload?.code === 'RATE_LIMIT') {
    throw new CommandExecutionError(
      payload.message || 'huodongxing events was rate limited by www.huodongxing.com',
      payload.hint || 'Wait a few minutes and retry from a real browser session.',
    );
  }
  if (payload?.code === 'INVALID_LIMIT') {
    throw new ArgumentError(payload.message || 'huodongxing limit must be a positive integer <= 50');
  }
  if (payload?.code === 'EMPTY_RESULT') {
    throw new EmptyResultError(
      'huodongxing events',
      payload.hint || 'No Huodongxing event cards were found. The page may be empty.',
    );
  }
  throw new CommandExecutionError(
    payload?.message || 'huodongxing events returned malformed extraction data',
    payload?.hint || 'Huodongxing extraction did not return the expected structured payload.',
  );
}

export function extractEventRows(limit = 20) {
  return requireExtractionRows(extractEventRowsPayload(limit));
}

cli({
  site: 'huodongxing',
  name: 'events',
  access: 'read',
  description: '活动行活动搜索（按标签、城市、日期、线上/线下、名称过滤）',
  domain: 'www.huodongxing.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'tag', type: 'string', default: '', help: '活动标签，例如 AI' },
    { name: 'city', type: 'string', default: '全部', help: '城市名，例如 北京 / 上海 / 全部' },
    { name: 'date', type: 'string', default: '', help: '开始日期，格式 YYYY-MM-DD' },
    { name: 'dateTo', type: 'string', default: '', help: '结束日期，格式 YYYY-MM-DD' },
    { name: 'eventType', type: 'int', default: undefined, help: '活动类型：1 线下，2 线上' },
    { name: 'qs', type: 'string', default: '', help: '按活动名称关键词过滤' },
    { name: 'limit', type: 'int', default: 20, help: '返回条数（1-50）' },
  ],
  columns: EVENTS_COLUMNS,
  func: async (page, args) => {
    const limit = requireLimit(args.limit);
    const url = buildEventsUrl(args);
    await page.goto(url);
    await page.wait(2);
    const result = await page.evaluate(`(${extractEventRowsPayload.toString()})(${limit})`);
    return filterRowsByDateRange(requireExtractionRows(result), args);
  },
});
