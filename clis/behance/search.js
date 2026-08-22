import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  ArgumentError,
  CommandExecutionError,
  EmptyResultError,
  TimeoutError,
} from '@jackwener/opencli/errors';

const BASE = 'https://www.behance.net';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36';

function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function cleanText(value) {
  return decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(value, pattern, group = 1) {
  const match = String(value ?? '').match(pattern);
  return match ? match[group] : null;
}

function attributeValue(attributes, name) {
  const match = String(attributes ?? '').match(
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'),
  );
  return match ? decodeEntities(match[1] ?? match[2] ?? '') : null;
}

function anchorsIn(html) {
  return [...String(html ?? '').matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      attributes: match[1],
      body: match[2],
      href: attributeValue(match[1], 'href'),
      ariaLabel: attributeValue(match[1], 'aria-label'),
      titleAttribute: attributeValue(match[1], 'title'),
      className: attributeValue(match[1], 'class'),
    }));
}

function projectTitle(anchor) {
  const label = cleanText(anchor.ariaLabel || anchor.titleAttribute);
  if (label && !/^title$/i.test(label)) {
    const unprefixed = label.replace(
      /^(?:(?:project\s+link|link\s+to\s+project)|项目的链接)\s*[-—:：]\s*/iu,
      '',
    );
    if (unprefixed !== label || !cleanText(anchor.body)) return unprefixed;
  }
  return cleanText(anchor.body);
}

function toCount(value) {
  if (!value) return null;
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function splitProjectCards(html) {
  const markers = [];
  const markerPattern = /\brole=["']article["']/gi;
  let match;
  while ((match = markerPattern.exec(html)) !== null) markers.push(match.index);
  return markers.map((start, index) => {
    const end = index + 1 < markers.length ? markers[index + 1] : html.length;
    return html.slice(start, end);
  });
}

function extractProjectTuples(html) {
  const tuples = [];
  const seen = new Set();

  for (const card of splitProjectCards(html)) {
    const anchors = anchorsIn(card);
    const projectAnchors = anchors.filter((anchor) =>
      /(?:^https:\/\/www\.behance\.net)?\/gallery\/\d+\//i.test(anchor.href || ''),
    );
    const linkAnchor = projectAnchors[0];
    const titleAnchor = projectAnchors.find((anchor) => projectTitle(anchor));
    const href = linkAnchor?.href || '';
    const path = firstMatch(
      href,
      /^(?:https:\/\/www\.behance\.net)?(\/gallery\/(\d+)\/[^?#]+)(?:[?#].*)?$/i,
      1,
    );
    const projectId = firstMatch(href, /\/gallery\/(\d+)\//i);
    const title = titleAnchor ? projectTitle(titleAnchor) : '';
    const authorAnchor = anchors.find((anchor) => {
      if (!anchor.href || /\/gallery\//i.test(anchor.href)) return false;
      return /\bOwners-owner-/i.test(anchor.className || '')
        || /(?:\?|&)tracking_source=search_projects(?:%7C|\|)/i.test(anchor.href);
    });

    if (!path || !projectId || !title || seen.has(projectId)) continue;
    seen.add(projectId);

    const visibleCounts = [...card.matchAll(
      /<span[^>]*\btitle=["']([\d,]+)["'][^>]*>/gi,
    )].map((match) => match[1]);
    const appreciations = visibleCounts[0] ?? firstMatch(
      card,
      /<span[^>]*class="screenReaderOnly"[^>]*>([\d,]+)\s+appreciations?\s+for\b/i,
    );
    const views = visibleCounts[1] ?? firstMatch(
      card,
      /<span[^>]*class="screenReaderOnly"[^>]*>([\d,]+)\s+views?\s+for\b/i,
    );
    const thumbnailUrl = firstMatch(
      card,
      /(https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/404_webp\/[^"'\s,]+)/i,
    ) ?? firstMatch(
      card,
      /(https:\/\/mir-s3-cdn-cf\.behance\.net\/projects\/404\/[^"'\s,]+)/i,
    );

    tuples.push([
      projectId,
      title,
      authorAnchor ? cleanText(authorAnchor.body) : null,
      toCount(appreciations),
      toCount(views),
      thumbnailUrl ? decodeEntities(thumbnailUrl) : null,
      new URL(decodeEntities(path), BASE).toString(),
    ]);
  }

  return tuples;
}

const command = cli({
  site: 'behance',
  name: 'search',
  description: '搜索 Behance 公开项目案例，返回标题、作者、可见统计、封面与项目链接',
  access: 'read',
  example: 'opencli behance search "industrial brand identity" --limit 12 -f json',
  domain: 'www.behance.net',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    {
      name: 'query',
      type: 'string',
      required: true,
      positional: true,
      help: '设计检索关键词，例如 "industrial brand identity"',
    },
    {
      name: 'limit',
      type: 'int',
      default: 20,
      help: '返回项目数量（1-50）',
    },
  ],
  columns: [
    'rank',
    'projectId',
    'title',
    'author',
    'appreciations',
    'views',
    'thumbnailUrl',
    'url',
  ],
  func: async (args) => {
    const query = String(args.query ?? '').trim();
    if (!query) throw new ArgumentError('query is required');

    const limit = Number(args.limit ?? 20);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    if (limit > 50) throw new ArgumentError('limit must be <= 50');

    const url = `${BASE}/search/projects/${encodeURIComponent(query)}`;
    let response;
    try {
      response = await fetch(url, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': USER_AGENT,
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new TimeoutError('behance search', 20);
      }
      throw new CommandExecutionError(
        `Behance search request failed: ${error?.message || error}`,
      );
    }
    if (!response.ok) {
      throw new CommandExecutionError(
        `Behance search request failed: HTTP ${response.status}`,
      );
    }

    const html = await response.text();
    if (/auth\.services\.adobe\.com\/.+profile-chooser/i.test(html)) {
      throw new CommandExecutionError(
        'Behance returned an Adobe profile chooser instead of public search results',
      );
    }

    const tuples = extractProjectTuples(html);
    if (tuples.length === 0) {
      throw new EmptyResultError(
        'behance search',
        `No public projects found for "${query}", or the result-card structure changed`,
      );
    }

    return tuples.slice(0, limit).map((item, index) => ({
      rank: index + 1,
      projectId: item[0],
      title: item[1],
      author: item[2],
      appreciations: item[3],
      views: item[4],
      thumbnailUrl: item[5],
      url: item[6],
    }));
  },
});

export const __test__ = {
  anchorsIn,
  attributeValue,
  command,
  cleanText,
  extractProjectTuples,
  projectTitle,
  splitProjectCards,
  toCount,
};
