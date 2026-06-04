import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

export const DOUYU_HOST = 'https://www.douyu.com';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

export function buildAbsoluteUrl(pathOrUrl) {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${DOUYU_HOST}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

export async function fetchDouyuText(url) {
  const response = await fetch(url, {
    headers: {
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'user-agent': DESKTOP_UA,
    },
  });
  if (!response.ok) {
    throw new CommandExecutionError(`Douyu request failed: HTTP ${response.status}`, url);
  }
  return response.text();
}

export function extractAssignedJson(html, variableName) {
  const marker = new RegExp(`var\\s+${escapeRegExp(variableName)}\\s*=\\s*`);
  const match = marker.exec(String(html || ''));
  if (!match) {
    throw new CommandExecutionError(`Could not find Douyu bootstrap variable ${variableName}`);
  }

  const start = html.indexOf('{', match.index + match[0].length);
  if (start < 0) {
    throw new CommandExecutionError(`Could not locate JSON start for ${variableName}`);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1));
    }
  }

  throw new CommandExecutionError(`Could not parse Douyu JSON payload for ${variableName}`);
}

export function resolveDouyuPath(slug) {
  const value = String(slug || '').trim();
  if (value === 'all') return '/directory/all';
  if (/^https?:\/\//.test(value)) return value;
  if (value.startsWith('/')) return value;
  if (value.startsWith('directory/')) return `/${value}`;
  if (value.startsWith('g_')) return `/${value}`;
  return `/g_${value}`;
}

export function parseDirectoryBootstrap(html) {
  try {
    return extractAssignedJson(html, '$ROOM');
  } catch {
    return extractAssignedJson(html, '$DATA');
  }
}

export function mapDirectoryRoom(item, index) {
  const roomPath = item?.url ?? (item?.rid ? `/${item.rid}` : '');
  return {
    rank: index + 1,
    title: item?.rn ?? '',
    anchor: item?.nn ?? '',
    watching: item?.ol ?? 0,
    category: item?.c2name ?? '',
    url: buildAbsoluteUrl(roomPath),
  };
}

export function parseLiveCardsFromHtml(html, limit) {
  const pattern = /<a class="DyLiveListCover-livingMask" href="([^"]+)"[^>]*>[\s\S]*?<div class="Common-card-AvatarHot-livingName">([^<]+)<\/div>[\s\S]*?<span class="Common-card-AvatarHotIcon-watching">([^<]+)<\/span>[\s\S]*?<a class="DyCardBottom-cardTitle" href="[^"]+"[^>]*title="([^"]+)"/g;
  const rows = [];
  let match = null;
  while ((match = pattern.exec(String(html || ''))) !== null && rows.length < limit) {
    rows.push({
      rank: rows.length + 1,
      title: decodeHtml(match[4]),
      anchor: decodeHtml(match[2]),
      watching: decodeHtml(match[3]),
      category: '',
      url: buildAbsoluteUrl(match[1]),
    });
  }
  return rows;
}

function matchFirst(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

export function parseRoomSummary(html, room) {
  const title = matchFirst(html, [
    /<h1[^>]*class="[^"]*roomName[^"]*"[^>]*>([^<]+)<\/h1>/s,
    /<meta property="og:title" content="([^"_]+)_/s,
    /<title>([^<_]+)_/s,
  ]);
  const anchor = matchFirst(html, [
    /<h3[^>]*class="[^"]*anchorName[^"]*"[^>]*>([^<]+)<\/h3>/s,
    /<img[^>]*alt="([^"]+)"[^>]*class="[^"]*avatarPic[^"]*"/s,
  ]);
  const category = matchFirst(html, [
    /<a[^>]*href="\/g_[^"]+"[^>]*><i[^>]*>[\s\S]*?<\/i>([^<]+)<\/a>/s,
    /"cate2Name":"([^"]+)"/,
  ]);
  const online = matchFirst(html, [
    /<span[^>]*class="[^"]*label__3Yn47[^"]*"[^>]*>[\s\S]*?<\/i>([^<]+)<\/span>/s,
    /"hn":"([^"]+)"/,
  ]);

  return {
    room,
    title,
    anchor,
    category,
    online,
    url: `${DOUYU_HOST}/${room}`,
  };
}

export function buildLiveCardExtractor(limit) {
  return `
    (() => {
      const max = ${Number(limit)};
      const isUnLogin = !!document.querySelector('.Header-login-wrap .UnLogin, a[href="/member/login"]');
      const anchors = Array.from(document.querySelectorAll(
        'a.livingMask__h7KLu[href^="/"], a.DyLiveListCover-livingMask[href^="/"], a[href^="/"][class*="livingMask"]'
      ));
      const seen = new Set();
      const rows = [];
      const text = (root, selectors) => {
        for (const selector of selectors) {
          const node = root?.querySelector(selector);
          const value = (node?.textContent || '').trim();
          if (value) return value;
        }
        return '';
      };

      for (const anchor of anchors) {
        const href = anchor.getAttribute('href') || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);
        const root = anchor.closest('div.card__Ty7ME, li, div[class*="Card"], div[class*="card"], div[class*="Item"], div[class*="item"]') || anchor.parentElement;
        const title = text(root, ['h3', '.cardTitle__i-BSx', '.DyCardBottom-cardTitle', '[class*="cardTitle"]']);
        const streamer = text(root, ['.livingName__YV44V', '.Common-card-AvatarName', '[class*="avatarName"]', '[class*="anchorName"]']);
        const watching = text(root, ['.watching__lpb2k', '.Common-card-AvatarHotIcon-watching', '[class*="watching"]']);
        const category = text(root, ['h6.cardTagContainer__WAkG6', '.DyCardBottom-liveType', '[class*="cardTag"]', '[class*="liveType"]']);
        if (!title) continue;
        rows.push({
          title,
          streamer,
          watching,
          category,
          url: href.startsWith('http') ? href : 'https://www.douyu.com' + href,
        });
        if (rows.length >= max) break;
      }
      return { isUnLogin, rows };
    })()
  `;
}

export function requireRows(rows, command, hint) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new EmptyResultError(command, hint);
  }
  return rows;
}

export function requireDouyuLogin(message = 'Douyu login is required') {
  throw new AuthRequiredError('www.douyu.com', message);
}
