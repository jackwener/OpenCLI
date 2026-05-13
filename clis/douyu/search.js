import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

export function normalizeSearchLimit(raw) {
  const parsed = Number(raw ?? 20);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new ArgumentError(`--limit must be an integer between 1 and 50, got ${JSON.stringify(raw)}`);
  }
  if (parsed < 1 || parsed > 50) {
    throw new ArgumentError(`--limit must be between 1 and 50, got ${parsed}`);
  }
  return parsed;
}

export function normalizeSearchQuery(raw) {
  const query = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!query) {
    throw new ArgumentError('douyu search query is required', 'Example: opencli douyu search 英雄联盟 -f yaml');
  }
  return query;
}

export function buildSearchUrl(query) {
  return `https://www.douyu.com/search/?kw=${encodeURIComponent(normalizeSearchQuery(query))}`;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function getAttr(tag, name) {
  const match = String(tag || '').match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match ? decodeHtml(match[1]) : '';
}

function toRoomUrl(href) {
  const room = (String(href || '').match(/(?:https:\/\/www\.douyu\.com)?\/(\d{2,})/) || [])[1] || '';
  return room ? { room, url: `https://www.douyu.com/${room}` } : { room: '', url: '' };
}

function findLiveSection(html) {
  const marker = html.search(/<h3[^>]*>\s*直播间\s*<\/h3>/);
  if (marker < 0) return '';
  const rest = html.slice(marker);
  const next = rest.slice(20).search(/<h3[^>]*>\s*(动态|热搜榜单|热门话题|视频|用户|鱼吧|话题)\s*<\/h3>/);
  return next >= 0 ? rest.slice(0, next + 20) : rest;
}

export function extractSearchResultsFromHtml(html, limit) {
  const section = findLiveSection(String(html || ''));
  if (!section) return [];

  const rows = [];
  const seen = new Set();
  const cards = section.match(/<li\b[\s\S]*?<\/li>/gi) || [];

  for (const card of cards) {
    const titleTag = (card.match(/<a\b(?=[^>]*\btitle=")(?=[^>]*\bhref="(?:https:\/\/www\.douyu\.com)?\/\d{2,})[^>]*>/i) || [])[0] || '';
    const href = getAttr(titleTag, 'href');
    const { room, url } = toRoomUrl(href);
    if (!room || seen.has(room)) continue;

    const title = getAttr(titleTag, 'title') || stripTags((card.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
    const streamer = stripTags((card.match(/class="[^"]*livingName[^"]*"[^>]*>([\s\S]*?)<\/div>/i) || [])[1])
      || decodeHtml((card.match(/<img\b[^>]*\balt="([^"]+)"/i) || [])[1] || '');
    const category = stripTags((card.match(/class="[^"]*cardTagContainer[^"]*"[^>]*>([\s\S]*?)<\/h6>/i) || [])[1]);
    const hot = (Array.from(card.matchAll(/class="[^"]*watching[^"]*"[^>]*>([\s\S]*?)<\/div>/gi))
      .map((match) => stripTags(match[1]))
      .find(Boolean)) || '';

    seen.add(room);
    rows.push({
      rank: rows.length + 1,
      room,
      streamer,
      title,
      category,
      hot,
      live_status: hot ? 'live' : 'unknown',
      url,
    });
    if (rows.length >= limit) break;
  }

  return rows;
}

async function fetchSearchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
  });
  if (!response.ok) {
    throw new CommandExecutionError(`Douyu search request failed: HTTP ${response.status}`);
  }
  return response.text();
}

export const command = cli({
  site: 'douyu',
  name: 'search',
  description: '搜索斗鱼直播间',
  access: 'read',
  example: 'opencli douyu search 英雄联盟 --limit 10 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of live room results to return (1-50)' },
  ],
  columns: ['rank', 'room', 'streamer', 'title', 'category', 'hot', 'live_status', 'url'],
  func: async (kwargs) => {
    const query = normalizeSearchQuery(kwargs.query);
    const limit = normalizeSearchLimit(kwargs.limit);
    const rows = extractSearchResultsFromHtml(await fetchSearchHtml(buildSearchUrl(query)), limit);
    if (!Array.isArray(rows) || rows.length === 0) {
      throw new EmptyResultError('douyu search', `No Douyu live rooms found for ${JSON.stringify(query)}`);
    }
    return rows.slice(0, limit);
  },
});
