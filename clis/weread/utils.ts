/**
 * WeRead shared helpers: fetch wrappers and formatting.
 *
 * Two API domains:
 * - WEB_API (weread.qq.com/web/*): public, Node.js fetch
 * - API (i.weread.qq.com/*): private, Node.js fetch with cookies from browser
 */

import { CliError } from '../../errors.js';
import type { BrowserCookie, IPage } from '../../types.js';

export const WEREAD_DOMAIN = 'weread.qq.com';
export const WEREAD_WEB_ORIGIN = `https://${WEREAD_DOMAIN}`;
export const WEREAD_SHELF_URL = `${WEREAD_WEB_ORIGIN}/web/shelf`;
const WEB_API = `${WEREAD_WEB_ORIGIN}/web`;
const API = `https://i.${WEREAD_DOMAIN}`;
export const WEREAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WEREAD_AUTH_ERRCODES = new Set([-2010, -2012]);

export interface WebShelfRawBook {
  bookId?: string;
  title?: string;
  author?: string;
}

export interface WebShelfIndexEntry {
  bookId?: string;
  idx?: number;
  role?: string;
}

export interface WebShelfSnapshot {
  cacheFound: boolean;
  rawBooks: WebShelfRawBook[];
  shelfIndexes: WebShelfIndexEntry[];
}

export interface WebShelfEntry {
  bookId: string;
  title: string;
  author: string;
  readerUrl: string;
}

export interface WebShelfReaderResolution {
  snapshot: WebShelfSnapshot;
  readerUrl: string | null;
}

interface WebShelfStorageKeys {
  rawBooksKey: string;
  shelfIndexesKey: string;
}

function buildCookieHeader(cookies: BrowserCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}

function isAuthErrorResponse(resp: Response, data: any): boolean {
  return resp.status === 401 || WEREAD_AUTH_ERRCODES.has(Number(data?.errcode));
}

function getCurrentVid(cookies: BrowserCookie[]): string {
  return String(cookies.find((cookie) => cookie.name === 'wr_vid')?.value || '').trim();
}

function getWebShelfStorageKeys(currentVid: string): WebShelfStorageKeys {
  return {
    rawBooksKey: `shelf:rawBooks:${currentVid}`,
    shelfIndexesKey: `shelf:shelfIndexes:${currentVid}`,
  };
}

function normalizeWebShelfSnapshot(value: Partial<WebShelfSnapshot> | null | undefined): WebShelfSnapshot {
  return {
    cacheFound: value?.cacheFound === true,
    rawBooks: Array.isArray(value?.rawBooks) ? value.rawBooks : [],
    shelfIndexes: Array.isArray(value?.shelfIndexes) ? value.shelfIndexes : [],
  };
}

function buildShelfSnapshotPollScript(storageKeys: WebShelfStorageKeys, requireTrustedIndexes: boolean): string {
  return `
    (() => new Promise((resolve) => {
      const deadline = Date.now() + 5000;
      const rawBooksKey = ${JSON.stringify(storageKeys.rawBooksKey)};
      const shelfIndexesKey = ${JSON.stringify(storageKeys.shelfIndexesKey)};
      const requireTrustedIndexes = ${JSON.stringify(requireTrustedIndexes)};

      const readJson = (raw) => {
        if (typeof raw !== 'string') return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const collectBookIds = (items) => Array.isArray(items)
        ? Array.from(new Set(items.map((item) => String(item?.bookId || '').trim()).filter(Boolean)))
        : [];

      // Mirror of getTrustedIndexedBookIds in Node.js — keep in sync
      const hasTrustedIndexes = (rawBooks, shelfIndexes) => {
        const rawBookIds = collectBookIds(rawBooks);
        if (rawBookIds.length === 0) return false;

        const rawBookIdSet = new Set(rawBookIds);
        const projectedIndexedBookIds = Array.isArray(shelfIndexes)
          ? Array.from(new Set(
              shelfIndexes
                .filter((entry) => Number.isFinite(entry?.idx))
                .sort((left, right) => Number(left?.idx ?? Number.MAX_SAFE_INTEGER) - Number(right?.idx ?? Number.MAX_SAFE_INTEGER))
                .map((entry) => String(entry?.bookId || '').trim())
                .filter((bookId) => rawBookIdSet.has(bookId)),
            ))
          : [];

        return projectedIndexedBookIds.length === rawBookIds.length;
      };

      const poll = () => {
        const rawBooks = readJson(localStorage.getItem(rawBooksKey));
        const shelfIndexes = readJson(localStorage.getItem(shelfIndexesKey));
        const cacheFound = Array.isArray(rawBooks);
        const ready = cacheFound && (!requireTrustedIndexes || hasTrustedIndexes(rawBooks, shelfIndexes));

        if (ready || Date.now() >= deadline) {
          resolve({
            cacheFound,
            rawBooks: Array.isArray(rawBooks) ? rawBooks : [],
            shelfIndexes: Array.isArray(shelfIndexes) ? shelfIndexes : [],
          });
          return;
        }

        setTimeout(poll, 100);
      };

      poll();
    }))
  `;
}

/**
 * Fetch a public WeRead web endpoint (Node.js direct fetch).
 * Used by search and ranking commands (browser: false).
 */
export async function fetchWebApi(path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${WEB_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': WEREAD_UA },
  });
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `HTTP ${resp.status} for ${path}`, 'WeRead API may be temporarily unavailable');
  }
  try {
    return await resp.json();
  } catch {
    throw new CliError('PARSE_ERROR', `Invalid JSON response for ${path}`, 'WeRead may have returned an HTML error page');
  }
}

/**
 * Fetch a private WeRead API endpoint with cookies extracted from the browser.
 * The HTTP request itself runs in Node.js to avoid page-context CORS failures.
 *
 * Cookies are collected from both the API subdomain (i.weread.qq.com) and the
 * main domain (weread.qq.com). WeRead may set auth cookies as host-only on
 * weread.qq.com, which won't match i.weread.qq.com in a URL-based lookup.
 */
export async function fetchPrivateApi(page: IPage, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const urlStr = url.toString();

  // Merge cookies from both domains; API-domain cookies take precedence on name collision
  const [apiCookies, domainCookies] = await Promise.all([
    page.getCookies({ url: urlStr }),
    page.getCookies({ domain: WEREAD_DOMAIN }),
  ]);
  const merged = new Map<string, BrowserCookie>();
  for (const c of domainCookies) merged.set(c.name, c);
  for (const c of apiCookies) merged.set(c.name, c);
  const cookieHeader = buildCookieHeader(Array.from(merged.values()));

  let resp: Response;
  try {
    resp = await fetch(urlStr, {
      headers: {
        'User-Agent': WEREAD_UA,
        'Origin': 'https://weread.qq.com',
        'Referer': 'https://weread.qq.com/',
        ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      },
    });
  } catch (error) {
    throw new CliError(
      'FETCH_ERROR',
      `Failed to fetch ${path}: ${error instanceof Error ? error.message : String(error)}`,
      'WeRead API may be temporarily unavailable',
    );
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    throw new CliError('PARSE_ERROR', `Invalid JSON response for ${path}`, 'WeRead may have returned an HTML error page');
  }

  if (isAuthErrorResponse(resp, data)) {
    throw new CliError('AUTH_REQUIRED', 'Not logged in to WeRead', 'Please log in to weread.qq.com in Chrome first');
  }
  if (!resp.ok) {
    throw new CliError('FETCH_ERROR', `HTTP ${resp.status} for ${path}`, 'WeRead API may be temporarily unavailable');
  }
  if (data?.errcode != null && data.errcode !== 0) {
    throw new CliError('API_ERROR', data.errmsg ?? `WeRead API error ${data.errcode}`);
  }
  return data;
}

function getUniqueRawBookIds(snapshot: WebShelfSnapshot): string[] {
  return Array.from(new Set(
    snapshot.rawBooks
      .map((book) => String(book?.bookId || '').trim())
      .filter(Boolean),
  ));
}

/** Mirror of hasTrustedIndexes in buildShelfSnapshotPollScript — keep in sync */
function getTrustedIndexedBookIds(snapshot: WebShelfSnapshot): string[] {
  const rawBookIds = getUniqueRawBookIds(snapshot);
  if (rawBookIds.length === 0) return [];

  const rawBookIdSet = new Set(rawBookIds);
  const projectedIndexedBookIds = Array.from(new Set(
    snapshot.shelfIndexes
      .filter((entry) => Number.isFinite(entry?.idx))
      .sort((left, right) => Number(left?.idx ?? Number.MAX_SAFE_INTEGER) - Number(right?.idx ?? Number.MAX_SAFE_INTEGER))
      .map((entry) => String(entry?.bookId || '').trim())
      .filter((bookId) => rawBookIdSet.has(bookId)),
  ));

  return projectedIndexedBookIds.length === rawBookIds.length ? projectedIndexedBookIds : [];
}

/**
 * Build stable shelf records from the web cache plus optional rendered reader URLs.
 * We only trust shelfIndexes when it fully covers the same bookId set as rawBooks;
 * otherwise we keep rawBooks order to avoid partial hydration reordering entries.
 */
export function buildWebShelfEntries(snapshot: WebShelfSnapshot, readerUrls: string[] = []): WebShelfEntry[] {
  const rawBookIds = getUniqueRawBookIds(snapshot);
  const trustedIndexedBookIds = getTrustedIndexedBookIds(snapshot);
  const orderedBookIds = trustedIndexedBookIds.length > 0 ? trustedIndexedBookIds : rawBookIds;

  const rawBookById = new Map<string, WebShelfRawBook>();
  for (const book of snapshot.rawBooks) {
    const bookId = String(book?.bookId || '').trim();
    if (!bookId || rawBookById.has(bookId)) continue;
    rawBookById.set(bookId, book);
  }

  return orderedBookIds.map((bookId, index) => {
    const book = rawBookById.get(bookId);
    return {
      bookId,
      title: String(book?.title || '').trim(),
      author: String(book?.author || '').trim(),
      readerUrl: String(readerUrls[index] || '').trim(),
    };
  });
}

/**
 * Internal: load shelf snapshot and return the currentVid alongside it,
 * so callers like resolveShelfReaderUrl can reuse it without a second getCookies.
 */
async function loadWebShelfSnapshotWithVid(page: IPage): Promise<{ snapshot: WebShelfSnapshot; currentVid: string }> {
  await page.goto(WEREAD_SHELF_URL);

  const cookies = await page.getCookies({ domain: WEREAD_DOMAIN });
  const currentVid = getCurrentVid(cookies);

  if (!currentVid) {
    return { snapshot: { cacheFound: false, rawBooks: [], shelfIndexes: [] }, currentVid: '' };
  }

  const result = await page.evaluate(
    buildShelfSnapshotPollScript(getWebShelfStorageKeys(currentVid), false),
  );
  return {
    snapshot: normalizeWebShelfSnapshot(result as Partial<WebShelfSnapshot> | null | undefined),
    currentVid,
  };
}

/**
 * Read the structured shelf cache from the WeRead shelf page.
 * The page hydrates localStorage asynchronously, so we poll briefly before
 * giving up and treating the cache as unavailable for the current session.
 */
export async function loadWebShelfSnapshot(page: IPage): Promise<WebShelfSnapshot> {
  const { snapshot } = await loadWebShelfSnapshotWithVid(page);
  return snapshot;
}

/**
 * `book` needs a trustworthy `bookId -> readerUrl` mapping, which may lag behind
 * the first rawBooks cache hydration. Keep the fast shelf fallback path separate
 * and only wait here, with a bounded poll, when resolving reader URLs.
 */
async function waitForTrustedWebShelfSnapshot(page: IPage, snapshot: WebShelfSnapshot, currentVid: string): Promise<WebShelfSnapshot> {
  // Cache not available; nothing to wait for
  if (!snapshot.cacheFound) return snapshot;
  // Indexes already fully cover rawBooks; no need to re-poll
  if (getTrustedIndexedBookIds(snapshot).length > 0) return snapshot;

  if (!currentVid) return snapshot;

  const result = await page.evaluate(
    buildShelfSnapshotPollScript(getWebShelfStorageKeys(currentVid), true),
  );
  return normalizeWebShelfSnapshot(result as Partial<WebShelfSnapshot> | null | undefined);
}

/**
 * Resolve a shelf bookId to the current web reader URL by pairing structured
 * shelf cache order with the visible shelf links rendered on the page.
 */
export async function resolveShelfReaderUrl(page: IPage, bookId: string): Promise<string | null> {
  const resolution = await resolveShelfReader(page, bookId);
  return resolution.readerUrl;
}

/**
 * Resolve the current reader URL for a shelf entry and return the parsed shelf
 * snapshot used during resolution, so callers can reuse cached title/author
 * metadata without loading the shelf page twice.
 */
export async function resolveShelfReader(page: IPage, bookId: string): Promise<WebShelfReaderResolution> {
  const { snapshot: initialSnapshot, currentVid } = await loadWebShelfSnapshotWithVid(page);
  const snapshot = await waitForTrustedWebShelfSnapshot(page, initialSnapshot, currentVid);
  if (!snapshot.cacheFound) {
    return { snapshot, readerUrl: null };
  }
  const rawBookIds = getUniqueRawBookIds(snapshot);
  const trustedIndexedBookIds = getTrustedIndexedBookIds(snapshot);
  const canUseRawOrderFallback = trustedIndexedBookIds.length === 0
    && rawBookIds.length > 0
    && snapshot.shelfIndexes.length === 0;
  if (trustedIndexedBookIds.length === 0 && !canUseRawOrderFallback) {
    return { snapshot, readerUrl: null };
  }

  const readerUrls = await page.evaluate(`
    (() => Array.from(document.querySelectorAll('a.shelfBook[href]'))
      .map((anchor) => {
        const href = anchor.getAttribute('href') || '';
        return href ? new URL(href, location.origin).toString() : '';
      })
      .filter(Boolean))
  `) as string[];
  const expectedEntryCount = trustedIndexedBookIds.length > 0 ? trustedIndexedBookIds.length : rawBookIds.length;
  if (readerUrls.length !== expectedEntryCount) {
    return { snapshot, readerUrl: null };
  }
  const entries = buildWebShelfEntries(snapshot, readerUrls);

  const entry = entries.find((candidate) => candidate.bookId === bookId);
  return {
    snapshot,
    readerUrl: entry?.readerUrl || null,
  };
}

/** Format a Unix timestamp (seconds) to YYYY-MM-DD in UTC+8. Returns '-' for invalid input. */
export function formatDate(ts: number | undefined | null): string {
  if (!Number.isFinite(ts) || (ts as number) <= 0) return '-';
  // WeRead timestamps are China-centric; offset to UTC+8 to avoid off-by-one near midnight
  const d = new Date((ts as number) * 1000 + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}
