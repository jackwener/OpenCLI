import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { BASE, normalizeLimit, normalizePositiveInteger, getCookie, fetchHtml, assertAuthenticated, parseTorrentRows } from './utils.js';

const ENUMS = {
  status: { alive: '1', dead: '2', all: '0' },
  promotion: { all: '0', normal: '1', free: '2', '2x': '3', '2x-free': '4', '50pct': '5', '2x-50pct': '6', '30pct': '7', other: '8' },
  bookmarked: { all: '0', only: '1', exclude: '2' },
  area: { title: '0', description: '1', uploader: '3', anidb: '4', hash: '5' },
  mode: { and: '0', or: '1', exact: '2' },
};

function enumValue(group, value, fallback) {
  const selected = String(value ?? fallback).toLowerCase();
  const mapped = ENUMS[group][selected];
  if (mapped === undefined) throw new ArgumentError(`invalid ${group}: ${value}`);
  return mapped;
}

export function buildTorrentQuery(args = {}) {
  const limit = normalizeLimit(args.limit, 50, 50);
  const page = normalizePositiveInteger(args.page, 1, 'page');
  const searchParams = new URLSearchParams();
  const query = String(args.query ?? '').trim();
  if (query) searchParams.set('search', query);
  const category = String(args.category ?? '').trim();
  if (category) {
    if (!/^[1-9]\d*$/.test(category)) throw new ArgumentError(`category must be a positive numeric ID`);
    searchParams.set(`cat${category}`, '1');
  }
  searchParams.set('incldead', enumValue('status', args.status, 'alive'));
  searchParams.set('spstate', enumValue('promotion', args.promotion, 'all'));
  searchParams.set('inclbookmarked', enumValue('bookmarked', args.bookmarked, 'all'));
  searchParams.set('search_area', enumValue('area', args.area, 'title'));
  searchParams.set('search_mode', enumValue('mode', args.mode, 'and'));
  if (page > 1) searchParams.set('page', String(page - 1));
  return { searchParams, limit };
}

cli({
  site: 'u2',
  name: 'torrents',
  access: 'read',
  description: '搜索 U2 种子；默认列出当前页 50 条活种',
  domain: 'u2.dmhy.org',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', positional: true, required: false, help: '搜索关键词；省略时列出最新种子' },
    { name: 'category', type: 'string', default: '', help: '分类 ID，例如 16（BDMV）；默认全部' },
    { name: 'status', type: 'string', default: 'alive', help: '种子状态：alive / dead / all' },
    { name: 'promotion', type: 'string', default: 'all', help: '优惠：all / normal / free / 2x / 2x-free / 50pct / 2x-50pct / 30pct / other' },
    { name: 'bookmarked', type: 'string', default: 'all', help: '收藏：all / only / exclude' },
    { name: 'area', type: 'string', default: 'title', help: '搜索范围：title / description / uploader / anidb / hash' },
    { name: 'mode', type: 'string', default: 'and', help: '匹配模式：and / or / exact' },
    { name: 'page', type: 'int', default: 1, help: '页码：从 1 开始；网页第二页对应 --page 2' },
    { name: 'limit', type: 'int', default: 50, help: '返回条数：1–50，默认 50（网页一页）' },
  ],
  columns: ['id', 'category', 'title', 'comments', 'publishedAt', 'size', 'seeders', 'leechers', 'snatched', 'promotion', 'detailsUrl'],
  func: async (page, args) => {
    const { searchParams, limit } = buildTorrentQuery(args);
    const cookie = await getCookie(page);
    const html = await fetchHtml(`${BASE}/torrents.php?${searchParams}`, { cookie });
    assertAuthenticated(html);
    const rows = parseTorrentRows(html);
    if (rows.length === 0) {
      const query = String(args.query ?? '').trim();
      throw new EmptyResultError('u2 torrents', query ? `No torrents found for "${query}"` : 'No torrents found');
    }
    return rows.slice(0, limit);
  },
});
