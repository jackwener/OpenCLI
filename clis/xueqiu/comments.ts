import type { IPage } from '../../src/types.js';
import { cli, Strategy } from '../../src/registry.js';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '../../src/errors.js';
import { log } from '../../src/logger.js';
import { isRecord } from '../../src/utils.js';

/**
 * Minimal browser-response shape used by the classifier.
 */
export interface XueqiuCommentsResponse {
  status: number;
  contentType: string;
  json: unknown;
  textSnippet: string;
}

/**
 * Minimal normalized row shape used during pagination and deduplication.
 */
export interface XueqiuCommentRow {
  id: string;
  author: string;
  text?: string;
  likes?: number;
  replies?: number;
  retweets?: number;
  created_at?: string | null;
  url?: string | null;
}

/**
 * Public CLI row shape. This intentionally omits the internal stable ID used
 * only for deduplication, so machine-readable output matches the command
 * contract and table columns.
 */
export type XueqiuCommentOutputRow = Omit<XueqiuCommentRow, 'id'>;

/**
 * Pagination options for collecting enough rows to satisfy `--limit`.
 */
export interface CollectCommentRowsOptions {
  symbol: string;
  limit: number;
  pageSize: number;
  maxRequests: number;
  fetchPage: (pageNumber: number, pageSize: number) => Promise<XueqiuCommentsResponse>;
  warn?: (message: string) => void;
}

type XueqiuCommentsKind = 'auth' | 'anti-bot' | 'argument' | 'empty' | 'incompatible' | 'unknown';

const XUEQIU_SYMBOL_PATTERN = /^(?:[A-Z]{2}\d{5,6}|\d{4,6}|[A-Z]{1,5}(?:[.-][A-Z]{1,2})?)$/;

const FAILURE_REASON_BY_KIND: Record<XueqiuCommentsKind, string> = {
  auth: 'auth failure',
  'anti-bot': 'anti-bot challenge',
  argument: 'invalid symbol',
  empty: 'no more discussion data',
  incompatible: 'unexpected response shape',
  unknown: 'unknown request failure',
};

function getCommentList(json: Record<string, unknown>): unknown[] | null {
  if (Array.isArray(json.list)) return json.list;
  if (isRecord(json.data) && Array.isArray(json.data.list)) return json.data.list;
  return null;
}

function isAntiBotHtml(response: XueqiuCommentsResponse, envelopeText: string): boolean {
  const htmlText = `${envelopeText} ${response.textSnippet}`.toLowerCase();
  return response.contentType.includes('text/html')
    && (
      /captcha|challenge|aliyun_waf|risk/i.test(htmlText)
      || /_WAF_|_waf_|renderData|aliyun_waf/i.test(response.textSnippet)
    );
}

function toFiniteCount(value: unknown): number {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function normalizeIdentifier(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function buildPaginationStopMessage(
  requestNumber: number,
  collected: number,
  target: number,
  reason: string,
): string {
  return `xueqiu comments pagination stopped after request ${requestNumber}, `
    + `collected ${collected}/${target} items, `
    + `reason: ${reason}`;
}

function throwFirstPageFailure(kind: XueqiuCommentsKind, symbol: string): never {
  if (kind === 'auth' || kind === 'anti-bot') {
    throw new AuthRequiredError('xueqiu.com', 'Stock discussions require login or challenge clearance');
  }
  if (kind === 'argument') {
    throw new ArgumentError(`xueqiu comments received an invalid symbol: ${symbol}`);
  }
  if (kind === 'empty') {
    throw new EmptyResultError(
      `xueqiu/comments ${symbol}`,
      `No discussion data found for ${symbol}`,
    );
  }
  throw new CommandExecutionError(
    `Unexpected response while loading xueqiu comments for ${symbol}`,
    'Run the command again with --verbose to inspect the raw site response.',
  );
}

/**
 * Extract the raw item list from one classified JSON payload.
 *
 * @param json Raw parsed JSON payload from browser fetch.
 * @returns Discussion items when the response shape is usable.
 */
export function getCommentItems(json: unknown): Record<string, any>[] {
  if (!isRecord(json)) return [];

  const list = getCommentList(json) ?? [];

  return list.filter((item): item is Record<string, any> => !!item && typeof item === 'object');
}

/**
 * Classify one raw browser response before command-level error handling.
 *
 * @param response Structured browser response payload.
 * @returns Tagged result describing the response class.
 */
export function classifyXueqiuCommentsResponse(response: XueqiuCommentsResponse): { kind: XueqiuCommentsKind } {
  const jsonRecord = isRecord(response.json) ? response.json : null;
  const commentList = jsonRecord ? getCommentList(jsonRecord) : null;
  const envelopeText = [
    jsonRecord?.error,
    jsonRecord?.errors,
    jsonRecord?.code,
    jsonRecord?.message,
    jsonRecord?.msg,
  ].filter(Boolean).join(' ').toLowerCase();
  const responseText = `${envelopeText} ${response.textSnippet}`.toLowerCase();

  if (isAntiBotHtml(response, envelopeText)) {
    return { kind: 'anti-bot' };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: 'auth' };
  }
  if (/login required|unauthorized|unauthorised|forbidden|not logged in|need login/.test(responseText)) {
    return { kind: 'auth' };
  }
  if (/invalid symbol|invalid code|bad symbol/.test(envelopeText)) {
    return { kind: 'argument' };
  }
  if (/no data|no result|not found|no matching/.test(envelopeText)) {
    return { kind: 'empty' };
  }
  if (commentList && commentList.length === 0) {
    return { kind: 'empty' };
  }
  if (response.contentType.includes('application/json') && jsonRecord && commentList === null) {
    return { kind: 'incompatible' };
  }
  return { kind: 'unknown' };
}

/**
 * Merge one new page of rows while preserving the first occurrence of each ID.
 *
 * @param current Rows already collected.
 * @param incoming Rows from the next page.
 * @returns Deduplicated merged rows.
 */
export function mergeUniqueCommentRows(
  current: XueqiuCommentRow[],
  incoming: XueqiuCommentRow[],
): XueqiuCommentRow[] {
  const merged = [...current];
  const seen = new Set(current.map(item => item.id));

  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

/**
 * Normalize one raw xueqiu discussion item into the CLI row shape.
 *
 * Returned rows represent stock-scoped discussion posts, not replies under
 * one parent post.
 *
 * @param item Raw API item.
 * @returns Cleaned CLI row.
 */
export function normalizeCommentItem(item: Record<string, any>): XueqiuCommentRow {
  const text = String(item.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

  const id = normalizeIdentifier(item.id);
  const userId = normalizeIdentifier(item.user?.id);

  const createdAtDate = item.created_at ? new Date(item.created_at) : null;
  const createdAt = createdAtDate && !Number.isNaN(createdAtDate.getTime())
    ? createdAtDate.toISOString()
    : null;

  return {
    id,
    author: String(item.user?.screen_name ?? ''),
    text,
    likes: toFiniteCount(item.fav_count),
    replies: toFiniteCount(item.reply_count),
    retweets: toFiniteCount(item.retweet_count),
    created_at: createdAt,
    url: userId && id ? `https://xueqiu.com/${userId}/${id}` : null,
  };
}

/**
 * Remove internal-only fields before returning rows to the CLI renderer.
 *
 * @param row Internal row shape used during pagination.
 * @returns Public output row that matches the documented command contract.
 */
export function toCommentOutputRow(row: XueqiuCommentRow): XueqiuCommentOutputRow {
  const { id: _id, ...outputRow } = row;
  return outputRow;
}

/**
 * Convert response classification into a compact warning phrase.
 *
 * @param kind Classifier result kind.
 * @returns Human-readable reason fragment for stderr warnings.
 */
export function describeFailureKind(kind: XueqiuCommentsKind): string {
  return FAILURE_REASON_BY_KIND[kind];
}

/**
 * Fetch one discussion page from inside the browser context so cookies and
 * any site-side request state stay attached to the request.
 *
 * @param page Active browser page.
 * @param symbol Normalized stock symbol.
 * @param pageNumber Internal page counter, starting from 1.
 * @param pageSize Item count per internal request.
 * @returns Structured response for command-side classification.
 */
export async function fetchCommentsPage(
  page: IPage,
  symbol: string,
  pageNumber: number,
  pageSize: number,
): Promise<XueqiuCommentsResponse> {
  const url = new URL('https://xueqiu.com/query/v1/symbol/search/status');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('count', String(pageSize));
  url.searchParams.set('page', String(pageNumber));
  url.searchParams.set('sort', 'time');

  return page.evaluate(`
    (async () => {
      try {
        const response = await fetch(${JSON.stringify(url.toString())}, {
          credentials: 'include',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'x-requested-with': 'XMLHttpRequest',
          },
          referrer: ${JSON.stringify(`https://xueqiu.com/S/${symbol}`)},
          referrerPolicy: 'strict-origin-when-cross-origin',
        });
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        let json = null;
        if (contentType.includes('application/json')) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        return {
          status: response.status,
          contentType,
          json,
          textSnippet: text.slice(0, 2000),
        };
      } catch (error) {
        return {
          status: 0,
          contentType: 'text/plain',
          json: null,
          textSnippet: error instanceof Error ? error.message : String(error),
        };
      }
    })()
  `) as Promise<XueqiuCommentsResponse>;
}

/**
 * Collect enough stock discussion rows to satisfy the requested limit.
 *
 * This helper owns the internal pagination policy so the public command
 * contract can stay small and expose only `--limit`.
 *
 * @param options Pagination inputs and a page-fetch callback.
 * @returns Deduplicated normalized rows, possibly partial with a warning.
 */
export async function collectCommentRows(options: CollectCommentRowsOptions): Promise<XueqiuCommentRow[]> {
  const warn = options.warn ?? log.warn;
  let rows: XueqiuCommentRow[] = [];
  const seenIds = new Set<string>();

  for (let requestNumber = 1; requestNumber <= options.maxRequests; requestNumber += 1) {
    const response = await options.fetchPage(requestNumber, options.pageSize);
    const classified = classifyXueqiuCommentsResponse(response);

    if (requestNumber === 1 && classified.kind !== 'unknown') {
      throwFirstPageFailure(classified.kind, options.symbol);
    } else if (classified.kind === 'empty') {
      break;
    } else if (classified.kind !== 'unknown') {
      warn(buildPaginationStopMessage(
        requestNumber,
        rows.length,
        options.limit,
        describeFailureKind(classified.kind),
      ));
      break;
    }

    const rawItems = getCommentItems(response.json);
    const pageRows = rawItems
      .map(item => normalizeCommentItem(item))
      .filter(row => row.id);
    if (pageRows.length === 0) {
      if (requestNumber === 1) {
        throw new CommandExecutionError(
          `Unexpected response while loading xueqiu comments for ${options.symbol}`,
          'Run the command again with --verbose to inspect the raw site response.',
        );
      }
      if (classified.kind === 'unknown') {
        warn(buildPaginationStopMessage(
          requestNumber,
          rows.length,
          options.limit,
          describeFailureKind(classified.kind),
        ));
      }
      break;
    }

    let advanced = false;
    for (const row of pageRows) {
      if (seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      rows.push(row);
      advanced = true;
    }

    if (rows.length >= options.limit) {
      return rows.slice(0, options.limit);
    }
    if (rawItems.length < options.pageSize) {
      break;
    }
    if (!advanced) {
      warn(buildPaginationStopMessage(
        requestNumber,
        rows.length,
        options.limit,
        'pagination did not advance',
      ));
      break;
    }
    if (requestNumber === options.maxRequests) {
      warn(buildPaginationStopMessage(requestNumber, rows.length, options.limit, 'reached safety cap'));
    }
  }

  return rows.slice(0, options.limit);
}

cli({
  site: 'xueqiu',
  name: 'comments',
  description: '获取单只股票的讨论动态',
  domain: 'xueqiu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'symbol',
      positional: true,
      required: true,
      help: 'Stock symbol, e.g. SH600519, AAPL, or 00700',
    },
    { name: 'limit', type: 'int', default: 20, help: 'Number of discussion posts to return' },
  ],
  columns: ['author', 'text', 'likes', 'replies', 'retweets', 'created_at', 'url'],
  func: async (page, args) => {
    const symbol = normalizeSymbolInput(args.symbol);
    const limit = Number(args.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('xueqiu comments requires --limit to be a positive integer');
    }
    if (limit > 100) {
      throw new ArgumentError('xueqiu comments supports --limit up to 100');
    }
    const pageSize = Math.min(limit, 20);
    await page.goto('https://xueqiu.com');
    const rows = await collectCommentRows({
      symbol,
      limit,
      pageSize,
      maxRequests: 5,
      fetchPage: (pageNumber, currentPageSize) => fetchCommentsPage(page, symbol, pageNumber, currentPageSize),
      warn: log.warn,
    });
    return rows.map(row => toCommentOutputRow(row));
  },
});

/**
 * Convert raw CLI input into a normalized stock symbol.
 *
 * @param raw User-provided CLI argument.
 * @returns Upper-cased symbol string.
 */
export function normalizeSymbolInput(raw: unknown): string {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (!symbol) throw new ArgumentError('xueqiu comments requires a symbol');
  if (/^HTTPS?:\/\//.test(symbol)) {
    throw new ArgumentError('xueqiu comments only accepts a symbol, not a URL');
  }
  if (!XUEQIU_SYMBOL_PATTERN.test(symbol)) {
    throw new ArgumentError(`xueqiu comments received an invalid symbol: ${symbol}`);
  }
  return symbol;
}
