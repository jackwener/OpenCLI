/**
 * WeRead shared helpers: fetch wrappers and formatting.
 *
 * Two API domains:
 * - WEB_API (weread.qq.com/web/*): public, Node.js fetch
 * - API (i.weread.qq.com/*): private, Node.js fetch with cookies from browser
 */

import { CliError } from '../../errors.js';
import type { BrowserCookie, IPage } from '../../types.js';

const WEB_API = 'https://weread.qq.com/web';
const API = 'https://i.weread.qq.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function buildCookieHeader(cookies: BrowserCookie[]): string {
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
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
    headers: { 'User-Agent': UA },
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
 */
export async function fetchPrivateApi(page: IPage, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`${API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  const urlStr = url.toString();

  const cookies = await page.getCookies({ url: urlStr });
  const cookieHeader = buildCookieHeader(cookies);

  let resp: Response;
  try {
    resp = await fetch(urlStr, {
      headers: {
        'User-Agent': UA,
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

  if (resp.status === 401 || data?.errcode === -2010) {
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

/** Format a Unix timestamp (seconds) to YYYY-MM-DD in UTC+8. Returns '-' for invalid input. */
export function formatDate(ts: number | undefined | null): string {
  if (!Number.isFinite(ts) || (ts as number) <= 0) return '-';
  // WeRead timestamps are China-centric; offset to UTC+8 to avoid off-by-one near midnight
  const d = new Date((ts as number) * 1000 + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}
