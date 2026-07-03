import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

export const BASE = 'https://u2.dmhy.org';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/146 Safari/537.36';

export function normalizePositiveInteger(value, defaultValue, label = 'value') {
  const n = Number(value ?? defaultValue);
  if (!Number.isInteger(n) || n <= 0) throw new ArgumentError(`${label} must be a positive integer`);
  return n;
}

export function normalizeLimit(value, defaultValue, maxValue, label = 'limit') {
  const n = normalizePositiveInteger(value, defaultValue, label);
  if (n > maxValue) throw new ArgumentError(`${label} must be <= ${maxValue}`);
  return n;
}

export async function getCookie(page) {
  const cookies = new Map();
  if (typeof page?.getCookies === 'function') {
    for (const options of [{ url: `${BASE}/` }, { domain: 'u2.dmhy.org' }, { domain: '.dmhy.org' }]) {
      try {
        for (const cookie of await page.getCookies(options) || []) {
          if (cookie?.name && !cookies.has(cookie.name)) cookies.set(cookie.name, cookie.value);
        }
      } catch { /* try the next cookie scope */ }
    }
  }
  if (cookies.size === 0) throw new AuthRequiredError('u2.dmhy.org', 'U2 browser cookies are missing; log in with Chrome first');
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

export async function fetchHtml(url, { cookie, headers = {} } = {}) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET', redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        ...(cookie ? { Cookie: cookie } : {}),
        Referer: `${BASE}/`,
        ...headers,
      },
    });
  } catch (error) {
    throw new CommandExecutionError(`U2 request failed: ${error?.message || error}`);
  }
  if (!response.ok) throw new CommandExecutionError(`U2 request failed: HTTP ${response.status} ${response.statusText}`);
  return response.text();
}

export function assertAuthenticated(html) {
  const source = String(html || '');
  const loginPage = /<form[^>]+(?:login\.php|takelogin\.php)/i.test(source)
    || /href=["'][^"']*login\.php/i.test(source);
  const loggedInMarker = /href=["'][^"']*logout\.php/i.test(source);
  if (loginPage || !loggedInMarker) {
    throw new AuthRequiredError('u2.dmhy.org', 'U2 session is missing or expired; log in with Chrome first');
  }
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all)
    .replace(/&amp(?=\s|$)/gi, '&');
}

function attribute(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : '';
}

function text(html) {
  return decodeEntities(String(html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[\u00ad\u200b]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function balancedElement(source, start, tagName) {
  const token = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi');
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(source))) {
    if (!match[0].startsWith('</')) depth += 1;
    else depth -= 1;
    if (depth === 0) return source.slice(start, token.lastIndex);
  }
  return '';
}

function allTables(html) {
  const source = String(html || '');
  const starts = [...source.matchAll(/<table\b[^>]*>/gi)];
  const result = [];
  for (const match of starts) {
    const table = balancedElement(source, match.index, 'table');
    if (table) result.push(table);
  }
  return result;
}

function directRows(table) {
  const tags = /<\/?(?:table|tr)\b[^>]*>/gi;
  const rows = [];
  let tableDepth = 0;
  let rowStart = -1;
  let match;
  while ((match = tags.exec(table))) {
    const closing = match[0].startsWith('</');
    const name = /^<\/?([a-z]+)/i.exec(match[0])?.[1].toLowerCase();
    if (name === 'table') tableDepth += closing ? -1 : 1;
    if (name === 'tr' && tableDepth === 1) {
      if (!closing && rowStart < 0) rowStart = match.index;
      if (closing && rowStart >= 0) {
        rows.push(table.slice(rowStart, tags.lastIndex));
        rowStart = -1;
      }
    }
  }
  return rows;
}

function directCells(row) {
  const tags = /<\/?(?:table|td|th)\b[^>]*>/gi;
  const cells = [];
  let tableDepth = 0;
  let cellStart = -1;
  let match;
  while ((match = tags.exec(row))) {
    const closing = match[0].startsWith('</');
    const name = /^<\/?([a-z]+)/i.exec(match[0])?.[1].toLowerCase();
    if (name === 'table') tableDepth += closing ? -1 : 1;
    if ((name === 'td' || name === 'th') && tableDepth === 0) {
      if (!closing && cellStart < 0) cellStart = match.index;
      if (closing && cellStart >= 0) {
        cells.push(row.slice(cellStart, tags.lastIndex));
        cellStart = -1;
      }
    }
  }
  return cells;
}

function isoU2Time(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}+08:00` : null;
}

function intCell(cell) {
  const value = text(cell).replace(/,/g, '');
  return /^\d+$/.test(value) ? Number(value) : 0;
}

export function parseTorrentRows(html) {
  const table = allTables(html).find(item => /class=["'][^"']*\btorrents\b/i.test(item.match(/^<table\b[^>]*>/i)?.[0] || ''));
  if (!table) return [];
  const rows = [];
  for (const row of directRows(table).slice(1)) {
    const cells = directCells(row);
    if (cells.length !== 8) continue;
    const linkTags = [...cells[1].matchAll(/<a\b[^>]*>/gi)].map(match => match[0]);
    const detailTag = linkTags.find(tag => /details\.php\?id=\d+/i.test(attribute(tag, 'href')));
    const href = detailTag ? attribute(detailTag, 'href') : '';
    const id = href.match(/[?&]id=(\d+)/)?.[1];
    if (!id) continue;
    const title = attribute(detailTag, 'title') || text(cells[1].match(/<a\b[^>]*details\.php[\s\S]*?<\/a>/i)?.[0]);
    const timeTag = cells[3].match(/<time\b[^>]*>/i)?.[0] || '';
    const promotionTag = [...cells[1].matchAll(/<img\b[^>]*>/gi)].map(match => match[0])
      .find(tag => /\bpro_/i.test(attribute(tag, 'class')));
    rows.push({
      id,
      category: text(cells[0]),
      title,
      comments: intCell(cells[2]),
      publishedAt: isoU2Time(attribute(timeTag, 'title')),
      size: text(cells[4]),
      seeders: intCell(cells[5]),
      leechers: intCell(cells[6]),
      snatched: intCell(cells[7]),
      promotion: promotionTag ? attribute(promotionTag, 'alt') || null : null,
      detailsUrl: `${BASE}/details.php?id=${id}`,
    });
  }
  return rows;
}

export function parseSubtitleRows(html) {
  const table = allTables(html).filter(item => /语言/.test(item) && /上传者/.test(item) && /添加时间/.test(item)).at(-1);
  if (!table) return [];
  const rows = [];
  for (const row of directRows(table).slice(1)) {
    const cells = directCells(row);
    if (cells.length !== 7) continue;
    const titleLink = cells[1].match(/<a\b[^>]*>/i)?.[0] || '';
    const onclick = attribute(titleLink, 'onclick');
    const id = onclick.match(/show_detail\s*\(\s*(\d+)\s*\)/i)?.[1];
    if (!id) continue;
    const languageTag = cells[0].match(/<img\b[^>]*>/i)?.[0] || '';
    const timeTag = cells[2].match(/<time\b[^>]*>/i)?.[0] || '';
    rows.push({
      id,
      language: attribute(languageTag, 'alt'),
      title: text(cells[1]),
      publishedAt: isoU2Time(attribute(timeTag, 'title')),
      size: text(cells[3]),
      downloads: intCell(cells[4]),
      uploader: text(cells[5]),
    });
  }
  return rows;
}
