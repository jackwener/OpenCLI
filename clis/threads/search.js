import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const BASE_URL = 'https://www.threads.com';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export function normalizeQuery(value) {
    const query = String(value ?? '').trim();
    if (!query) throw new ArgumentError('query is required');
    return query;
}

export function normalizeLimit(value, defaultValue = DEFAULT_LIMIT, maxValue = MAX_LIMIT) {
    const raw = value ?? defaultValue;
    const limit = Number(raw);
    if (!Number.isInteger(limit) || limit <= 0) throw new ArgumentError('limit must be a positive integer');
    if (limit > maxValue) throw new ArgumentError(`limit must be <= ${maxValue}`);
    return limit;
}

export function buildSearchUrl(query) {
    const url = new URL('/search', BASE_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('serp_type', 'default');
    return url.toString();
}

export function parseCompactCount(value) {
    const text = String(value ?? '').replace(/,/g, '').trim();
    if (!text) return null;
    const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*(万|[KkMm])?$/);
    if (!match) return null;
    const n = Number(match[1]);
    const unit = match[2] ?? '';
    const multiplier = unit === '万' ? 10_000 : /k/i.test(unit) ? 1_000 : /m/i.test(unit) ? 1_000_000 : 1;
    return Math.round(n * multiplier);
}

export function parseThreadsTimestamp(value) {
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日.*?(\d{1,2}):(\d{2})$/);
    if (!match) return text || null;
    const [, year, month, day, hour, minute] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), 0);
    if (Number.isNaN(date.getTime())) return text;
    return date.toISOString();
}

function normalizeExtractedRows(rows, limit) {
    if (!Array.isArray(rows)) throw new CommandExecutionError('Threads search response shape changed: rows missing');
    return rows
        .filter((row) => row && row.username && row.url && row.text)
        .slice(0, limit)
        .map((row, index) => ({
            rank: index + 1,
            username: String(row.username),
            displayName: row.displayName ? String(row.displayName) : null,
            text: String(row.text).trim(),
            timestamp: row.timestamp ? String(row.timestamp) : null,
            url: String(row.url),
            replyCount: Number.isFinite(row.replyCount) ? row.replyCount : null,
            repostCount: Number.isFinite(row.repostCount) ? row.repostCount : null,
            likeCount: Number.isFinite(row.likeCount) ? row.likeCount : null,
        }));
}

const EXTRACT_SEARCH_ROWS_SCRIPT = `
  (async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const normalizeLines = (value) => String(value || '').split('\\n').map((line) => line.trim()).filter(Boolean);
    const parseCount = (value) => {
      const text = String(value || '').replace(/,/g, '').trim();
      if (!text) return null;
      const match = text.match(/^([0-9]+(?:\\.[0-9]+)?)\\s*(万|[KkMm])?$/);
      if (!match) return null;
      const unit = match[2] || '';
      const multiplier = unit === '万' ? 10000 : /k/i.test(unit) ? 1000 : /m/i.test(unit) ? 1000000 : 1;
      return Math.round(Number(match[1]) * multiplier);
    };
    const parseTimestamp = (value) => {
      const text = String(value || '').trim();
      const match = text.match(/^(\\d{4})年(\\d{1,2})月(\\d{1,2})日.*?(\\d{1,2}):(\\d{2})$/);
      if (!match) return text || null;
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0);
      return Number.isNaN(date.getTime()) ? text : date.toISOString();
    };
    const isProfileHref = (href) => /^\\/@[^/?#]+\\/?$/.test(href || '');
    const isPostHref = (href) => /\\/post\\//.test(href || '') && !/\\/media(?:[?#/]|$)/.test(href || '');
    const absoluteUrl = (href) => {
      try { return new URL(href, location.origin).toString().split('?')[0]; }
      catch { return String(href || ''); }
    };
    const buttonForSvg = (svg) => {
      let node = svg;
      for (let i = 0; i < 6 && node; i += 1, node = node.parentElement) {
        if ((node.getAttribute('role') || '').includes('button')) return node;
      }
      return null;
    };
    const actionCount = (card, labels) => {
      for (const svg of Array.from(card.querySelectorAll('svg[aria-label]'))) {
        if (!labels.includes(svg.getAttribute('aria-label'))) continue;
        const button = buttonForSvg(svg);
        const count = parseCount(button && button.innerText);
        if (count !== null) return count;
      }
      return null;
    };
    const findCard = (postLink) => {
      let card = postLink;
      for (let depth = 0; depth < 14 && card; depth += 1, card = card.parentElement) {
        const uniquePostUrls = new Set(
          Array.from(card.querySelectorAll('a'))
            .map((link) => absoluteUrl(link.getAttribute('href') || ''))
            .filter((href) => href.includes('/post/') && !href.includes('/media'))
        );
        const profile = Array.from(card.querySelectorAll('a')).find((link) => isProfileHref(link.getAttribute('href') || ''));
        const time = card.querySelector('time');
        const labels = Array.from(card.querySelectorAll('svg[aria-label]')).map((svg) => svg.getAttribute('aria-label'));
        if (uniquePostUrls.size === 1 && profile && time && labels.some((label) => ['赞', '回复', '评论', '转发', '分享'].includes(label))) {
          return card;
        }
      }
      return null;
    };
    const cleanPostText = (card, username, displayName, visibleTime) => {
      const remove = new Set([username, displayName, visibleTime, '翻译', '关注', '更多', '已编辑'].filter(Boolean));
      for (const svg of Array.from(card.querySelectorAll('svg[aria-label]'))) {
        const button = buttonForSvg(svg);
        const buttonText = normalize(button && button.innerText);
        if (buttonText) remove.add(buttonText);
      }
      return normalizeLines(card.innerText)
        .filter((line) => !remove.has(line))
        .filter((line) => !/^\\d+\\s*\\/\\s*\\d+$/.test(line))
        .join('\\n')
        .trim();
    };
    const loginWallVisible = () => {
      const text = document.body ? document.body.innerText || '' : '';
      return location.pathname.includes('/login')
        || (/登录或注册 Threads/.test(text) && /用 Instagram 登录/.test(text))
        || (/Log in or sign up/.test(text) && /Instagram/.test(text));
    };
    const extractRows = () => {
      const rows = [];
      const seen = new Set();
      const postLinks = Array.from(document.links).filter((link) => isPostHref(link.getAttribute('href') || ''));
      for (const link of postLinks) {
        const url = absoluteUrl(link.getAttribute('href') || link.href);
        if (!url || seen.has(url)) continue;
        const card = findCard(link);
        if (!card) continue;
        const profile = Array.from(card.querySelectorAll('a')).find((item) => isProfileHref(item.getAttribute('href') || ''));
        const profileHref = profile && profile.getAttribute('href') || '';
        const username = profileHref.replace(/^\\/@/, '').replace(/\\/$/, '');
        const displayName = null;
        const timeEl = card.querySelector('time');
        const visibleTime = normalize(timeEl && timeEl.innerText);
        const timestamp = parseTimestamp(timeEl && (timeEl.getAttribute('title') || timeEl.innerText));
        const text = cleanPostText(card, username, displayName, visibleTime);
        if (!username || !text) continue;
        rows.push({
          username,
          displayName,
          text,
          timestamp,
          url,
          replyCount: actionCount(card, ['回复', '评论']),
          repostCount: actionCount(card, ['转发']),
          likeCount: actionCount(card, ['赞']),
        });
        seen.add(url);
        if (rows.length >= limit) break;
      }
      return rows;
    };

    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (loginWallVisible()) return { authRequired: true, rows: [] };
      const rows = extractRows();
      if (rows.length > 0) return { rows };
      await sleep(400);
    }
    if (loginWallVisible()) return { authRequired: true, rows: [] };
    return { timeout: true, rows: extractRows() };
  })()
`;

export const searchCommand = cli({
    site: 'threads',
    name: 'search',
    access: 'read',
    description: 'Search Threads posts using the logged-in browser session',
    domain: 'www.threads.com',
    strategy: Strategy.UI,
    navigateBefore: false,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Max results (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'username', 'displayName', 'text', 'timestamp', 'url', 'replyCount', 'repostCount', 'likeCount'],
    func: async (page, args) => {
        const query = normalizeQuery(args.query);
        const limit = normalizeLimit(args.limit);

        await page.goto(buildSearchUrl(query), { allowBoundNavigation: true, settleMs: 2000 });
        const result = await page.evaluateWithArgs(EXTRACT_SEARCH_ROWS_SCRIPT, { limit });
        if (!result || typeof result !== 'object') {
            throw new CommandExecutionError('Threads search response shape changed: extractor returned no object');
        }
        if (result.authRequired) {
            throw new AuthRequiredError('www.threads.com', 'Not logged in to Threads in the active Chrome profile');
        }
        const rows = normalizeExtractedRows(result.rows, limit);
        if (rows.length === 0) {
            if (result.timeout) throw new TimeoutError('Threads search results', 12);
            throw new EmptyResultError('threads search', `No post results for "${query}"`);
        }
        return rows;
    },
});

export const __test__ = {
    buildSearchUrl,
    normalizeExtractedRows,
    normalizeLimit,
    normalizeQuery,
    parseCompactCount,
    parseThreadsTimestamp,
};
