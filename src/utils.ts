/**
 * Shared utility functions used across the codebase.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import TurndownService from 'turndown';
import { LoginWallError } from './errors.js';

/** Type guard: checks if a value is a non-null, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Simple async concurrency limiter. */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Pause for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Save a base64-encoded string to a file, creating parent directories as needed. */
export async function saveBase64ToFile(base64: string, filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  await fs.promises.writeFile(filePath, Buffer.from(base64, 'base64'));
}

export function createMarkdownConverter(configure?: (td: TurndownService) => void): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  td.addRule('linebreak', {
    filter: 'br',
    replacement: () => '\n',
  });

  if (configure) configure(td);
  return td;
}

export function htmlToMarkdown(value: string, configure?: (td: TurndownService) => void): string {
  return createMarkdownConverter(configure).turndown(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// \u2500\u2500 HTML-as-JSON response sniffer \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// Adapters that hit JSON endpoints (twitter list-tweets / thread, reddit
// search / subreddit, etc.) historically did blind `JSON.parse(await r.text())`
// or `await r.json()`. When the server returns a login wall, rate-limit page,
// or WAF challenge instead of JSON, the body starts with `<!DOCTYPE html>` or
// `<html ...>` and the parser blows up with a cryptic
// `SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`
// that callers can't distinguish from "real" malformed JSON.
//
// `parseJsonOrThrowLoginWall` is the Node-side version (consumes a Fetch
// `Response`). Adapters that fetch from inside `page.evaluate` should use the
// `LOGIN_WALL_SENTINEL` + `throwIfLoginWall` pair: the browser-side fetch
// sniffs the response and either returns the parsed JSON wrapped in
// `{ ok: true, data }`, or `{ ok: false, loginWall: { ... } }`; the Node side
// inspects the result and throws a structured `LoginWallError`.

/** Sentinel shape that browser-side `fetch` wrappers return when they detect an
 * HTML response in place of JSON. Kept as a plain object so it survives the
 * `page.evaluate` JSON round-trip. */
export interface LoginWallSignal {
  __loginWall: true;
  status: number;
  url: string;
  contentType: string;
  bodyPreview: string;
}

function isLoginWallSignal(v: unknown): v is LoginWallSignal {
  return (
    typeof v === 'object'
    && v !== null
    && (v as Record<string, unknown>).__loginWall === true
    && typeof (v as Record<string, unknown>).status === 'number'
  );
}

/** Throw a `LoginWallError` if `value` is the sentinel returned by the
 * browser-side sniffer; otherwise return `value` unchanged. Adapters that
 * fetch from inside `page.evaluate` call this on the result before consuming
 * it, so the Node-side gets a typed error instead of a JSON-parse stack
 * trace. */
export function throwIfLoginWall<T>(value: T, opts: { url?: string } = {}): T {
  if (isLoginWallSignal(value)) {
    throw new LoginWallError(
      `Server returned HTML instead of JSON (status=${value.status}). `
      + `Likely a login wall, rate limit, or WAF challenge.`,
      value.status,
      opts.url || value.url || '',
      value.bodyPreview,
    );
  }
  return value;
}

/** Parse a `Response` body as JSON, throwing `LoginWallError` if the server
 * returned an HTML page (login wall / rate limit / WAF interception) instead
 * of the expected JSON. Catches the common case of `<!DOCTYPE` or `<html`
 * leading the body \u2014 naive `JSON.parse` on these gives a cryptic
 * `SyntaxError` that callers can't distinguish from "real" malformed JSON.
 *
 * On real (non-HTML) JSON-parse failures, throws a regular `Error` with a
 * body preview attached so debugging doesn't require a packet capture. */
export async function parseJsonOrThrowLoginWall(
  response: Response,
  opts: { url?: string } = {},
): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  const trimmed = text.trimStart();

  const looksLikeHtml =
    contentType.toLowerCase().includes('text/html')
    || trimmed.startsWith('<!DOCTYPE')
    || trimmed.startsWith('<!doctype')
    || trimmed.startsWith('<html')
    || trimmed.startsWith('<HTML');

  if (looksLikeHtml) {
    throw new LoginWallError(
      `Server returned HTML instead of JSON (status=${response.status}). `
      + `Likely a login wall, rate limit, or WAF challenge.`,
      response.status,
      opts.url || response.url || '',
      trimmed.slice(0, 100),
    );
  }

  try {
    return JSON.parse(text);
  } catch (err) {
    // Real malformed JSON \u2014 surface body preview alongside the parser message
    // so we don't have to repro to know what came back.
    throw new Error(
      `JSON parse failed (status=${response.status}, body[0..50]=${JSON.stringify(trimmed.slice(0, 50))}): `
      + (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Browser-side JS source fragment (as a string) that performs a `fetch` and
 * either returns the parsed JSON body or a `LoginWallSignal` sentinel when
 * the response is HTML. Intended to be embedded inside an adapter's
 * `page.evaluate` block.
 *
 * Usage from inside a `page.evaluate` IIFE:
 *
 *     ${BROWSER_JSON_SNIFF_FN}
 *     const res = await fetchJsonOrLoginWall('/some/path.json', { credentials: 'include' });
 *     // res is the parsed JSON object, OR { __loginWall: true, status, url, contentType, bodyPreview }
 *     return res;
 *
 * The Node side then calls `throwIfLoginWall(res, { url })` on the result. */
export const BROWSER_JSON_SNIFF_FN = `
async function fetchJsonOrLoginWall(input, init) {
  const r = await fetch(input, init);
  const contentType = r.headers.get('content-type') || '';
  const text = await r.text();
  const trimmed = text.replace(/^\\s+/, '');
  const looksLikeHtml =
    contentType.toLowerCase().includes('text/html')
    || trimmed.startsWith('<!DOCTYPE')
    || trimmed.startsWith('<!doctype')
    || trimmed.startsWith('<html')
    || trimmed.startsWith('<HTML');
  if (looksLikeHtml) {
    return {
      __loginWall: true,
      status: r.status,
      url: r.url || (typeof input === 'string' ? input : ''),
      contentType,
      bodyPreview: trimmed.slice(0, 100),
    };
  }
  if (!r.ok) {
    return { error: r.status };
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(
      'JSON parse failed (status=' + r.status + ', body[0..50]=' + JSON.stringify(trimmed.slice(0, 50)) + '): '
      + (err && err.message ? err.message : String(err))
    );
  }
}
`;
