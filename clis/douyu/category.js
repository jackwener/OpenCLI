import { CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  buildAbsoluteUrl,
  fetchDouyuText,
  mapDirectoryRoom,
  parseDirectoryBootstrap,
  parseLiveCardsFromHtml,
  requireRows,
  resolveDouyuPath,
} from './public-utils.js';

function normalizeLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(50, Math.floor(limit));
}

export const command = cli({
  site: 'douyu',
  name: 'category',
  description: '获取斗鱼分类直播列表',
  access: 'read',
  example: 'opencli douyu category all --limit 10 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'slug', required: true, positional: true, help: 'Category slug: all, LOL, g_LOL, /g_LOL' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return (1-50)' },
  ],
  columns: ['rank', 'title', 'anchor', 'watching', 'category', 'url'],
  func: async (kwargs) => {
    const page = Math.max(1, Math.floor(Number(kwargs.page ?? 1)));
    const limit = normalizeLimit(kwargs.limit);
    const path = resolveDouyuPath(kwargs.slug);
    const pageUrl = buildAbsoluteUrl(path) + (page > 1 ? `?page=${page}` : '');
    const html = await fetchDouyuText(pageUrl);

    let bootstrap;
    try {
      bootstrap = parseDirectoryBootstrap(html);
    } catch {
      return requireRows(parseLiveCardsFromHtml(html, limit), 'douyu category', `Could not parse category page ${pageUrl}`);
    }

    let items = Array.isArray(bootstrap.roomList)
      ? bootstrap.roomList
      : (Array.isArray(bootstrap.list) ? bootstrap.list : []);

    if (page > 1 && bootstrap.pagePath) {
      const apiUrl = buildAbsoluteUrl(`${bootstrap.pagePath}${page}`);
      const response = await fetch(apiUrl, {
        headers: {
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent': 'Mozilla/5.0',
        },
      });
      if (!response.ok) {
        throw new CommandExecutionError(`Douyu category page request failed: HTTP ${response.status}`, apiUrl);
      }
      const payload = await response.json();
      items = payload?.data?.rl ?? [];
    }

    return requireRows(
      items.slice(0, limit).map((item, index) => mapDirectoryRoom(item, index)),
      'douyu category',
      `No Douyu live rooms found for ${String(kwargs.slug)}`,
    );
  },
});
