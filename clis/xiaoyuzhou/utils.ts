/**
 * Shared Xiaoyuzhou utilities — page data extraction and formatting.
 *
 * Xiaoyuzhou (小宇宙) is a Next.js app that embeds full page data in
 * <script id="__NEXT_DATA__">. We fetch the HTML and extract that JSON
 * instead of using their authenticated API.
 */

import { CliError } from '../../src/errors.js';

/**
 * Fetch a Xiaoyuzhou page and extract __NEXT_DATA__.props.pageProps.
 * @param path - URL path, e.g. '/podcast/xxx' or '/episode/xxx'
 */
export async function fetchPageProps(path: string): Promise<any> {
  const url = `https://www.xiaoyuzhoufm.com${path}`;
  // Node.js fetch sends UA "node" which gets blocked; use a browser-like UA
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; opencli)' },
  });
  if (!resp.ok) {
    throw new CliError(
      'FETCH_ERROR',
      `HTTP ${resp.status} for ${path}`,
      'Please check the ID — you can find it in xiaoyuzhoufm.com URLs',
    );
  }
  const html = await resp.text();
  // [\s\S]*? for multiline safety (JSON may span lines)
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new CliError(
      'PARSE_ERROR',
      'Failed to extract __NEXT_DATA__',
      'Page structure may have changed',
    );
  }
  let parsed: any;
  try { parsed = JSON.parse(match[1]); }
  catch { throw new CliError('PARSE_ERROR', 'Malformed __NEXT_DATA__ JSON', 'Page structure may have changed'); }
  const pageProps = parsed.props?.pageProps;
  if (!pageProps || Object.keys(pageProps).length === 0) {
    throw new CliError(
      'NOT_FOUND',
      'Resource not found',
      'Please check the ID — you can find it in xiaoyuzhoufm.com URLs',
    );
  }
  return pageProps;
}

/** Format seconds to mm:ss (e.g. 3890 → "64:50"). Returns '-' for invalid input. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '-';
  seconds = Math.round(seconds);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Format ISO date string to YYYY-MM-DD. Returns '-' for missing input. */
export function formatDate(iso: string): string {
  if (!iso) return '-';
  return iso.slice(0, 10);
}
