import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, normalizeLimit, normalizePositiveInteger, getCookie, fetchHtml, assertAuthenticated, parseSubtitleRows } from './utils.js';

export function buildSubtitleQuery(args = {}) {
  const limit = normalizeLimit(args.limit, 30, 30);
  const page = normalizePositiveInteger(args.page, 1, 'page');
  const searchParams = new URLSearchParams();
  const query = String(args.query ?? '').trim();
  if (query) searchParams.set('search', query);
  const language = String(args.language ?? 'all').trim().toLowerCase();
  if (language === 'all') {
    searchParams.set('lang_id', '0');
  } else {
    const languageId = Number(language);
    if (!Number.isInteger(languageId) || languageId < 1 || languageId > 32) {
      throw new ArgumentError('language must be all or a numeric ID from 1 to 32');
    }
    searchParams.set('lang_id', String(languageId));
  }
  if (page > 1) searchParams.set('page', String(page - 1));
  return { searchParams, limit };
}

cli({
  site: 'u2',
  name: 'subtitles',
  access: 'read',
  description: '搜索 U2 字幕；默认列出当前页 30 条',
  domain: 'u2.dmhy.org',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '搜索关键词；省略时列出最新字幕' },
    { name: 'language', type: 'string', default: 'all', help: '语言：all 或语言 ID（1–32；简中 25，繁中 28/32）' },
    { name: 'page', type: 'int', default: 1, help: '页码：从 1 开始；网页第二页对应 --page 2' },
    { name: 'limit', type: 'int', default: 30, help: '返回条数：1–30，默认 30（网页一页）' },
  ],
  columns: ['id', 'language', 'title', 'publishedAt', 'size', 'downloads', 'uploader'],
  func: async (page, args) => {
    const { searchParams, limit } = buildSubtitleQuery(args);
    const cookie = await getCookie(page);
    const html = await fetchHtml(`${BASE}/subtitles.php?${searchParams}`, { cookie });
    assertAuthenticated(html);
    const rows = parseSubtitleRows(html);
    if (rows.length === 0) {
      const query = String(args.query ?? '').trim();
      throw new EmptyResultError('u2 subtitles', query ? `No subtitles found for "${query}"` : 'No subtitles found');
    }
    return rows.slice(0, limit);
  },
});
