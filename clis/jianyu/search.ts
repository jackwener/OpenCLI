/**
 * Jianyu search — browser DOM extraction from Jianyu bid search page.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import {
  buildSearchCandidates,
  cleanText,
  dedupeCandidates,
  detectAuthPrompt,
  normalizeDate,
  searchRowsFromEntries,
} from './shared/china-bid-search.js';
import { toProcurementSearchRecords } from './shared/procurement-contract.js';

const SITE = 'jianyu';
const DOMAIN = 'www.jianyu360.cn';
const SEARCH_ENTRY = 'https://www.jianyu360.cn/jylab/supsearch/index.html';
const SEARCH_ENTRIES = [
  SEARCH_ENTRY,
  'https://www.jianyu360.cn/list/stype/ZBGG.html',
  'https://www.jianyu360.cn/',
];
const SEARCH_INDEX_PROXY = 'https://r.jina.ai/http://duckduckgo.com/html/?q=';
const PROCUREMENT_TITLE_HINT = /(公告|招标|采购|中标|成交|项目|投标|结果|notice|tender|procurement|bidding)/i;
const AUTH_REQUIRED_HINT = /(请在下图依次点击|登录即可获得更多浏览权限|验证登录|请完成验证|图形验证码)/;
const NAVIGATION_PATH_PREFIXES = [
  '/product/',
  '/front/',
  '/helpcenter/',
  '/brand/',
  '/page_workdesktop/',
  '/list/',
  '/list/stype/',
  '/list/rmxm',
  '/big/page/',
  '/jylab/',
  '/tags/',
  '/sitemap',
  '/datasmt/',
  '/bank/',
  '/hj/',
  '/exhibition/',
  '/swordfish/page_big_pc/search/',
];
const JIANYU_API_TYPES = ['fType', 'eType', 'vType', 'mType'] as const;

interface JianyuApiPayload {
  antiVerify?: number;
  error_code?: number;
  hasLogin?: boolean;
  textVerify?: string;
  list?: unknown[];
}

interface JianyuApiResponse {
  type: string;
  ok: boolean;
  status: number;
  payload?: JianyuApiPayload;
}

export function buildSearchUrl(query: string): string {
  const url = new URL(SEARCH_ENTRY);
  url.searchParams.set('keywords', query.trim());
  url.searchParams.set('selectType', 'title');
  url.searchParams.set('searchGroup', '1');
  return url.toString();
}

function siteSearchCandidates(query: string): string[] {
  const preferred = buildSearchUrl(query);
  const fallbacks = buildSearchCandidates(query, SEARCH_ENTRIES, ['keywords', 'keyword', 'q', 'search', 'title']);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [preferred, ...fallbacks]) {
    const value = cleanText(candidate);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function isLikelyNavigationUrl(rawUrl: string): boolean {
  const urlText = cleanText(rawUrl);
  if (!urlText) return true;
  try {
    const parsed = new URL(urlText);
    const path = cleanText(parsed.pathname).toLowerCase().replace(/\/+$/, '/') || '/';
    if (path === '/') return true;
    if (NAVIGATION_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
    return false;
  } catch {
    return true;
  }
}

function filterNavigationRows(query: string, items: Array<{
  title?: string;
  url?: string;
  date?: string;
  contextText?: string;
}>): Array<{
  title: string;
  url: string;
  date?: string;
  contextText?: string;
}> {
  const queryTokens = cleanText(query).split(/\s+/).filter(Boolean).map((token) => token.toLowerCase());
  return items
    .map((item) => ({
      title: cleanText(item.title),
      url: cleanText(item.url),
      date: normalizeDate(cleanText(item.date)),
      contextText: cleanText(item.contextText),
    }))
    .filter((item) => {
      if (!item.title || !item.url) return false;
      const haystack = `${item.title} ${item.contextText}`.toLowerCase();
      const hasQuery = queryTokens.length === 0 || queryTokens.some((token) => haystack.includes(token));
      const hasProcurementHint = PROCUREMENT_TITLE_HINT.test(`${item.title} ${item.contextText}`);
      const hasDate = !!item.date;
      if (!hasQuery) return false;
      if (!isLikelyNavigationUrl(item.url)) return true;
      return hasDate && hasProcurementHint;
    });
}

async function isAuthRequired(page: any): Promise<boolean> {
  const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
  if (AUTH_REQUIRED_HINT.test(pageText)) return true;
  return detectAuthPrompt(page);
}

function toAbsoluteJianyuUrl(rawUrl: string): string {
  const value = cleanText(rawUrl);
  if (!value) return '';
  if (value.startsWith('http://') || value.startsWith('https://')) return value;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) {
    try {
      return new URL(value, SEARCH_ENTRY).toString();
    } catch {
      return '';
    }
  }
  return '';
}

function extractDateFromJianyuUrl(rawUrl: string): string {
  const value = cleanText(rawUrl);
  if (!value) return '';
  const matched = value.match(/\/(20\d{2})(\d{2})(\d{2})(?:[_/]|$)/);
  if (!matched) return '';
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
}

function flattenStrings(input: unknown, depth = 0): string[] {
  if (depth > 2 || input == null) return [];
  if (typeof input === 'string' || typeof input === 'number') {
    const text = cleanText(String(input));
    return text ? [text] : [];
  }
  if (Array.isArray(input)) {
    return input.flatMap((item) => flattenStrings(item, depth + 1));
  }
  if (typeof input === 'object') {
    return Object.values(input as Record<string, unknown>).flatMap((item) => flattenStrings(item, depth + 1));
  }
  return [];
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = cleanText(String(value));
      if (text) return text;
    }
  }
  return '';
}

function normalizeApiRow(item: unknown): {
  title: string;
  url: string;
  date?: string;
  contextText?: string;
} | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const allStrings = flattenStrings(record);

  let url = toAbsoluteJianyuUrl(pickString(record, [
    'url',
    'detailUrl',
    'detailURL',
    'link',
    'href',
    'articleUrl',
    'newsUrl',
    'contentUrl',
    'jumpUrl',
    'sourceUrl',
  ]));
  if (!url) {
    const maybeUrl = allStrings.find((value) => /jianyu360\.cn|\/jybx\/|\/nologin\/content\//i.test(value)) || '';
    url = toAbsoluteJianyuUrl(maybeUrl);
  }

  let title = cleanText(pickString(record, [
    'title',
    'noticeTitle',
    'bidTitle',
    'projectName',
    'name',
    'articleTitle',
    'newsTitle',
    'tenderTitle',
    'contentTitle',
  ]));
  if (!title) {
    title = allStrings.find((value) => value.length >= 8 && PROCUREMENT_TITLE_HINT.test(value)) || '';
  }

  const date = normalizeDate(pickString(record, [
    'publishTime',
    'publishDate',
    'pubDate',
    'createTime',
    'time',
    'releaseTime',
    'date',
  ])) || extractDateFromJianyuUrl(url);

  const contextText = cleanText([
    pickString(record, ['content', 'summary', 'desc', 'description', 'buyer', 'winner', 'agency', 'industry']),
    ...allStrings.slice(0, 6),
  ].filter(Boolean).join(' '));

  if (!title || !url) return null;
  return {
    title,
    url,
    date,
    contextText,
  };
}

function parseSearchIndexMarkdown(markdown: string): Array<{ title: string; url: string }> {
  const rows: Array<{ title: string; url: string }> = [];
  for (const line of markdown.split('\n')) {
    const text = line.trim();
    if (!text.startsWith('## [')) continue;
    const right = text.slice(3);
    const sep = right.lastIndexOf('](');
    if (sep <= 0 || !right.endsWith(')')) continue;
    const title = cleanText(right.slice(1, sep));
    const url = cleanText(right.slice(sep + 2, -1));
    if (!title || !url) continue;
    rows.push({ title, url });
  }
  return rows;
}

function unwrapDuckDuckGoUrl(rawUrl: string): string {
  const candidate = cleanText(rawUrl);
  if (!candidate) return '';
  const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith('duckduckgo.com')) return normalized;
    const uddg = parsed.searchParams.get('uddg');
    if (!uddg) return normalized;
    try {
      return decodeURIComponent(uddg);
    } catch {
      return uddg;
    }
  } catch {
    return '';
  }
}

function isJianyuHost(rawUrl: string): boolean {
  const value = cleanText(rawUrl);
  if (!value) return false;
  try {
    return new URL(value).hostname.toLowerCase().endsWith('jianyu360.cn');
  } catch {
    return false;
  }
}

function buildIndexQueryVariants(query: string): string[] {
  const tokens = cleanText(query).split(/\s+/).filter(Boolean);
  const values = [cleanText(query), ...tokens];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    ordered.push(text);
  }
  return ordered;
}

async function fetchDuckDuckGoIndexRows(query: string, limit: number): Promise<Array<{
  title: string;
  url: string;
  date?: string;
  contextText?: string;
}>> {
  const results: Array<{ title: string; url: string; date?: string; contextText?: string }> = [];
  const seen = new Set<string>();

  for (const variant of buildIndexQueryVariants(query)) {
    if (results.length >= limit) break;
    const fullQuery = `site:jianyu360.cn ${variant}`;
    const url = `${SEARCH_INDEX_PROXY}${encodeURIComponent(fullQuery)}`;
    let responseText = '';
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'text/plain, text/markdown, */*',
          'User-Agent': 'opencli-jianyu-search/1.0',
        },
      });
      if (!response.ok) continue;
      responseText = await response.text();
    } catch {
      continue;
    }

    const indexedRows = parseSearchIndexMarkdown(responseText);
    for (const row of indexedRows) {
      const unwrapped = unwrapDuckDuckGoUrl(row.url);
      const absoluteUrl = toAbsoluteJianyuUrl(unwrapped) || cleanText(unwrapped);
      if (!isJianyuHost(absoluteUrl)) continue;
      const key = `${row.title}\t${absoluteUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        title: cleanText(row.title),
        url: absoluteUrl,
        date: extractDateFromJianyuUrl(absoluteUrl),
        contextText: cleanText(`${row.title} ${variant}`),
      });
      if (results.length >= limit) break;
    }
  }

  return results;
}

async function fetchJianyuApiRows(page: any, query: string, limit: number): Promise<{
  rows: Array<{ title: string; url: string; date?: string; contextText?: string }>;
  challenge: boolean;
}> {
  try {
    await page.goto(buildSearchUrl(query));
    await page.wait(2);

    const payload = await page.evaluate(`
      (async () => {
        const now = Math.floor(Date.now() / 1000);
        const body = {
          searchGroup: 1,
          reqType: 'lastNews',
          pageNum: 1,
          pageSize: Math.max(20, Math.min(${Math.max(20, limit)}, 50)),
          keyWords: ${JSON.stringify(query)},
          searchMode: 0,
          bidField: '',
          publishTime: \`\${now - 3600 * 24 * 365 * 3}-\${now}\`,
          selectType: 'title,content',
          subtype: '',
          exclusionWords: '',
          buyer: '',
          winner: '',
          agency: '',
          industry: '',
          province: '',
          city: '',
          district: '',
          buyerClass: '',
          fileExists: '',
          price: '',
          buyerTel: '',
          winnerTel: '',
        };
        const responses = [];
        const types = ${JSON.stringify([...JIANYU_API_TYPES])};
        for (const type of types) {
          try {
            const response = await fetch('/jyapi/jybx/core/' + type + '/searchList', {
              method: 'POST',
              headers: {
                Accept: 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
              },
              credentials: 'include',
              body: JSON.stringify(body),
            });
            let raw = null;
            try {
              raw = await response.json();
            } catch {
              raw = null;
            }
            const dataList = raw && raw.data && Array.isArray(raw.data.list) ? raw.data.list : [];
            responses.push({
              type,
              ok: response.ok,
              status: response.status,
              payload: {
                antiVerify: raw && typeof raw.antiVerify === 'number' ? raw.antiVerify : undefined,
                error_code: raw && typeof raw.error_code === 'number' ? raw.error_code : undefined,
                hasLogin: raw && typeof raw.hasLogin === 'boolean' ? raw.hasLogin : undefined,
                textVerify: raw && typeof raw.textVerify === 'string' ? raw.textVerify.slice(0, 16) : undefined,
                list: dataList,
              },
            });
          } catch {
            responses.push({
              type,
              ok: false,
              status: 0,
            });
          }
        }
        const challenge = responses.some((item) => item && item.payload && item.payload.antiVerify === -1);
        return { challenge, responses };
      })()
    `) as {
      challenge?: unknown;
      responses?: unknown[];
    };

    const rows: Array<{ title: string; url: string; date?: string; contextText?: string }> = [];
    const seen = new Set<string>();
    const responses = Array.isArray(payload?.responses) ? payload.responses : [];
    for (const response of responses) {
      if (!response || typeof response !== 'object') continue;
      const meta = response as { payload?: unknown };
      const body = meta.payload;
      if (!body || typeof body !== 'object') continue;
      const list = (body as JianyuApiPayload).list;
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const row = normalizeApiRow(item);
        if (!row) continue;
        const key = `${row.title}\t${row.url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        if (rows.length >= limit) break;
      }
      if (rows.length >= limit) break;
    }

    const challenge = Boolean(payload?.challenge);
    return { rows, challenge };
  } catch {
    return { rows: [], challenge: false };
  }
}

cli({
  site: SITE,
  name: 'search',
  description: '搜索剑鱼标讯公告',
  domain: DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword, e.g. "procurement"' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'content_type', 'title', 'publish_time', 'project_code', 'budget_or_limit', 'url'],
  func: async (page, kwargs) => {
    const query = cleanText(kwargs.query);
    const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
    const apiResult = await fetchJianyuApiRows(page, query, limit);
    const mergedRows = dedupeCandidates(filterNavigationRows(query, apiResult.rows));

    const extractedRows = await searchRowsFromEntries(page, {
      query,
      candidateUrls: siteSearchCandidates(query),
      allowedHostFragments: ['jianyu360.cn'],
      limit,
    });
    const domRows = dedupeCandidates(filterNavigationRows(query, extractedRows));
    const rows = dedupeCandidates([...mergedRows, ...domRows]);

    if (rows.length === 0) {
      const indexedRows = await fetchDuckDuckGoIndexRows(query, limit);
      const filteredIndexedRows = dedupeCandidates(filterNavigationRows(query, indexedRows));
      if (filteredIndexedRows.length > 0) {
        return toProcurementSearchRecords(filteredIndexedRows, {
          site: SITE,
          query,
          limit,
        });
      }

      if (apiResult.challenge || await isAuthRequired(page)) {
        throw new AuthRequiredError(
          DOMAIN,
          '[taxonomy=selector_drift] site=jianyu command=search blocked by human verification / access challenge',
        );
      }
    }

    return toProcurementSearchRecords(rows, {
      site: SITE,
      query,
      limit,
    });
  },
});

export const __test__ = {
  buildSearchCandidates: siteSearchCandidates,
  buildSearchUrl,
  normalizeDate,
  dedupeCandidates,
  filterNavigationRows,
  parseSearchIndexMarkdown,
  unwrapDuckDuckGoUrl,
  extractDateFromJianyuUrl,
  normalizeApiRow,
};
