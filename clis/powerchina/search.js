/**
 * PowerChina search — browser DOM extraction with multi-entry URL probing.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import {
  cleanText,
  normalizeDate,
  toProcurementSearchRecords,
} from '../jianyu/shared/procurement-contract.js';
import { searchRowsFromEntries } from '../jianyu/shared/china-bid-search.js';

const SEARCH_ENTRIES = [
  'https://bid.powerchina.cn/search',
  'https://bid.powerchina.cn/',
];
const API_LIST_ENDPOINT = 'https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/list';
const API_DETAIL_ENDPOINT = 'https://bid.powerchina.cn/newcbs/recpro-newmember/BidAnnouncementSummary/getInfo';
const API_DEFAULT_ANNOUNCEMENT_TYPE = '招采公告';

const PROCUREMENT_TITLE_HINT = /(公告|招标|采购|中标|成交|项目|notice|tender|bidding)/i;
const NAVIGATION_TITLE_HINT = /^(english|中文|chinese|language|home|首页|搜索|search)$/i;
const RETRYABLE_SEARCH_ERROR_HINT = /(detached while handling command|execution context was destroyed|target closed|cannot find context with specified id)/i;

export function buildSearchCandidates(query) {
  const keyword = query.trim();
  if (!keyword) return [...SEARCH_ENTRIES];
  const encoded = encodeURIComponent(keyword);
  return [
    `https://bid.powerchina.cn/search?keyword=${encoded}`,
    `https://bid.powerchina.cn/search?keywords=${encoded}`,
    `https://bid.powerchina.cn/search?q=${encoded}`,
    ...SEARCH_ENTRIES,
  ];
}

function dedupeCandidates(items) {
  const deduped = [];
  const seen = new Set();
  for (const item of items) {
    const key = `${item.title}\t${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function isLikelyNavigationUrl(rawUrl) {
  const urlText = cleanText(rawUrl);
  if (!urlText) return true;
  try {
    const parsed = new URL(urlText);
    const pathname = parsed.pathname.toLowerCase().replace(/\/+$/, '') || '/';
    const hash = cleanText(parsed.hash).toLowerCase();
    if (pathname === '/' || pathname === '/index') return true;
    if (pathname === '/search') return true;
    if (pathname === '/old' || pathname.startsWith('/old/')) return true;
    if (pathname === '/en' || pathname.startsWith('/en/')) return true;
    if (pathname === '/zh' || pathname.startsWith('/zh/')) return true;
    if (hash === '#/' || hash === '#/index' || hash.startsWith('#/search')) return true;
    return false;
  } catch {
    return true;
  }
}

function isLikelyNavigationTitle(rawTitle) {
  const title = cleanText(rawTitle);
  if (!title) return true;
  const normalized = title.toLowerCase();
  if (NAVIGATION_TITLE_HINT.test(normalized)) return true;
  if (normalized.length <= 10 && (normalized === 'en' || normalized === 'zh' || normalized.includes('english'))) {
    return true;
  }
  return false;
}

function filterNavigationRows(items) {
  return items.filter((item) => {
    const title = cleanText(item.title);
    const url = cleanText(item.url);
    if (!url || !title) return false;
    if (isLikelyNavigationUrl(url)) return false;
    if (isLikelyNavigationTitle(title) && !PROCUREMENT_TITLE_HINT.test(title)) return false;
    return true;
  });
}

export function buildApiDetailUrl(id) {
  const normalizedId = cleanText(id);
  if (!normalizedId) return '';
  return `${API_DETAIL_ENDPOINT}/${encodeURIComponent(normalizedId)}`;
}

function toApiCandidate(row) {
  const id = cleanText(row.id);
  const title = cleanText(row.title);
  if (!id || !title) return null;

  const url = buildApiDetailUrl(id);
  if (!url) return null;

  const contextText = cleanText([
    row.announcementType,
    row.titleTypeName,
    row.source,
    row.publishTime,
    row.registrationDeadline,
    row.submissionDeadline,
    row.bidOpenTime,
  ].filter(Boolean).join(' | '));

  const date = normalizeDate(cleanText(row.publishTime || row.bidOpenTime || row.submissionDeadline || ''));
  return {
    title,
    url,
    date,
    contextText,
  };
}

async function searchRowsFromApi(query, limit) {
  const keyword = cleanText(query);
  const pageSize = Math.max(20, Math.min(100, Math.max(limit * 3, limit)));
  const payload = {
    pageNum: 1,
    pageSize,
    announcementType: API_DEFAULT_ANNOUNCEMENT_TYPE,
    companyType: '3',
    time: Date.now(),
  };
  if (keyword) payload.keyWords = keyword;

  const response = await fetch(API_LIST_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`[taxonomy=relay_unavailable] site=powerchina command=search api HTTP ${response.status}`);
  }

  const data = await response.json();
  if ((data.code ?? 200) !== 200) {
    throw new Error(`[taxonomy=relay_unavailable] site=powerchina command=search api code=${data.code ?? 'unknown'} msg=${cleanText(data.msg)}`);
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];
  const mapped = rows
    .map((row) => toApiCandidate(row))
    .filter(Boolean);
  return dedupeCandidates(mapped).slice(0, limit);
}

cli({
  site: 'powerchina',
  name: 'search',
  description: '搜索中国电建阳光采购公告',
  domain: 'bid.powerchina.cn',
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
    let extractedRows = [];
    let apiFailure = null;
    let apiSucceeded = false;

    try {
      const apiRows = await searchRowsFromApi(query, limit);
      extractedRows = apiRows;
      apiSucceeded = true;
    } catch (error) {
      apiFailure = cleanText(error instanceof Error ? error.message : String(error || ''));
    }

    if (apiSucceeded && extractedRows.length === 0) {
      return [];
    }

    if (!apiSucceeded) {
      try {
        extractedRows = await searchRowsFromEntries(page, {
          query,
          candidateUrls: buildSearchCandidates(query),
          allowedHostFragments: ['bid.powerchina.cn', 'powerchina.cn'],
          limit,
        });
      } catch (error) {
        const message = cleanText(error instanceof Error ? error.message : String(error || ''));
        if (RETRYABLE_SEARCH_ERROR_HINT.test(message)) {
          throw new Error(`[taxonomy=relay_unavailable] site=powerchina command=search detached browser context: ${message}`);
        }
        throw error;
      }
    }

    const rows = filterNavigationRows(
      dedupeCandidates(extractedRows).map((item) => ({
        title: cleanText(item.title),
        url: cleanText(item.url),
        date: normalizeDate(cleanText(item.date)),
        contextText: cleanText(item.contextText),
      })),
    );

    if (rows.length === 0 && extractedRows.length > 0) {
      throw new Error('[taxonomy=empty_result] site=powerchina command=search extracted only navigation/portal rows');
    }

    if (rows.length === 0) {
      const pageText = cleanText(await page.evaluate('document.body ? document.body.innerText : ""'));
      if (/(请先登录|未登录|登录后|验证码|人机验证)/.test(pageText)) {
        throw new AuthRequiredError(
          'bid.powerchina.cn',
          '[taxonomy=selector_drift] site=powerchina command=search login required or human verification',
        );
      }
      if (apiFailure) {
        throw new Error(`[taxonomy=empty_result] site=powerchina command=search api/dom yielded no result: ${apiFailure}`);
      }
    }

    return toProcurementSearchRecords(rows, {
      site: 'powerchina',
      query,
      limit,
    });
  },
});

export const __test__ = {
  buildSearchCandidates,
  normalizeDate,
  dedupeCandidates,
  filterNavigationRows,
  isLikelyNavigationUrl,
  isLikelyNavigationTitle,
  buildApiDetailUrl,
  toApiCandidate,
};
