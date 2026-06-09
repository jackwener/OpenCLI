/**
 * Pipeline step: fetch — HTTP API requests.
 */

import { CliError, getErrorMessage } from '../../errors.js';
import { log } from '../../logger.js';
import type { IPage } from '../../types.js';
import { render } from '../template.js';

import { isRecord, mapConcurrent } from '../../utils.js';

/**
 * Matches an `item` or `index` per-item binding inside a `${{ ... }}` expression.
 *
 * Per-item fan-out is gated on this, so it must distinguish a real binding from a
 * URL that merely contains the substring "item" (e.g. `.../items`). The `\b` word
 * boundaries also keep plural/compound identifiers like `items.length` from firing.
 *
 * Both `item` and `index` are first-class per-item render bindings (see
 * RenderContext / resolvePath in ../template.ts and the `{ args, data, item, index }`
 * context passed below), so a URL such as `.../page/${{ index }}` over array data
 * must legitimately fan out — gating on `item` alone would be a false-negative.
 */
const ITEM_BINDING_RE = /\$\{\{[^}]*\b(?:item|index)\b[^}]*\}\}/;

/** Single URL fetch helper */
async function fetchSingle(
  page: IPage | null, url: string, method: string,
  queryParams: Record<string, unknown>, headers: Record<string, unknown>,
  args: Record<string, unknown>, data: unknown,
): Promise<unknown> {
  const renderedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) renderedParams[k] = String(render(v, { args, data }));
  const renderedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) renderedHeaders[k] = String(render(v, { args, data }));

  let finalUrl = url;
  if (Object.keys(renderedParams).length > 0) {
    const qs = new URLSearchParams(renderedParams).toString();
    finalUrl = `${finalUrl}${finalUrl.includes('?') ? '&' : '?'}${qs}`;
  }

  if (page === null) {
    const resp = await fetch(finalUrl, { method: method.toUpperCase(), headers: renderedHeaders });
    if (!resp.ok) {
      throw new CliError('FETCH_ERROR', `HTTP ${resp.status} ${resp.statusText} from ${finalUrl}`);
    }
    return resp.json();
  }

  return page.fetchJson(finalUrl, { method: method.toUpperCase(), headers: renderedHeaders });
}

/**
 * Batch fetch: send all URLs into the browser as a single evaluate() call.
 * This eliminates N-1 cross-process IPC round trips, performing all fetches
 * inside the V8 engine and returning results as one JSON array.
 */
async function fetchBatchInBrowser(
  page: IPage, urls: string[], method: string,
  headers: Record<string, string>, concurrency: number,
): Promise<unknown[]> {
  const headersJs = JSON.stringify(headers);
  const urlsJs = JSON.stringify(urls);
  const methodJs = JSON.stringify(method);
  return (await page.evaluate(`
    async () => {
      const urls = ${urlsJs};
      const method = ${methodJs};
      const headers = ${headersJs};
      const concurrency = ${concurrency};

      const results = new Array(urls.length);
      let idx = 0;

      async function worker() {
        while (idx < urls.length) {
          const i = idx++;
          try {
            const resp = await fetch(urls[i], { method, headers, credentials: "include" });
            if (!resp.ok) {
              throw new Error('HTTP ' + resp.status + ' ' + resp.statusText + ' from ' + urls[i]);
            }
            results[i] = await resp.json();
          } catch (e) {
            results[i] = { error: e instanceof Error ? e.message : String(e) };
            // Note: getErrorMessage() is a Node.js utility — can't use it inside evaluate()
          }
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
      await Promise.all(workers);
      return results;
    }
  `)) as unknown[];
}

export async function stepFetch(page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  const paramObject = isRecord(params) ? params : {};
  const urlOrObj = typeof params === 'string' ? params : (paramObject.url ?? '');
  const method = typeof paramObject.method === 'string' ? paramObject.method : 'GET';
  const queryParams = isRecord(paramObject.params) ? paramObject.params : {};
  const headers = isRecord(paramObject.headers) ? paramObject.headers : {};
  const urlTemplate = String(urlOrObj);

  // Per-item fetch when data is an array and the URL template binds `item` or
  // `index` inside a ${{ ... }} expression (see ITEM_BINDING_RE), rather than the
  // raw substring, so innocuous URLs like .../items don't trigger per-item fan-out.
  if (Array.isArray(data) && ITEM_BINDING_RE.test(urlTemplate)) {
    const concurrency = typeof paramObject.concurrency === 'number' ? paramObject.concurrency : 5;

    // Render all URLs upfront
    const renderedHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) renderedHeaders[k] = String(render(v, { args, data }));
    const renderedParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(queryParams)) renderedParams[k] = String(render(v, { args, data }));

    const urls = data.map((item, index) => {
      let url = String(render(urlTemplate, { args, data, item, index }));
      if (Object.keys(renderedParams).length > 0) {
        const qs = new URLSearchParams(renderedParams).toString();
        url = `${url}${url.includes('?') ? '&' : '?'}${qs}`;
      }
      return url;
    });

    // BATCH IPC: if browser is available, batch all fetches into a single evaluate() call
    if (page !== null) {
      const results = await fetchBatchInBrowser(page, urls, method.toUpperCase(), renderedHeaders, concurrency);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && typeof r === 'object' && 'error' in r) {
          log.warn(`Batch fetch failed for ${urls[i]}: ${(r as { error: string }).error}`);
        }
      }
      return results;
    }

    // Non-browser: use concurrent pool (already optimized)
    return mapConcurrent(data, concurrency, async (item, index) => {
      const itemUrl = String(render(urlTemplate, { args, data, item, index }));
      try {
        return await fetchSingle(null, itemUrl, method, queryParams, headers, args, data);
      } catch (error) {
        const message = getErrorMessage(error);
        log.warn(`Batch fetch failed for ${itemUrl}: ${message}`);
        return { error: message };
      }
    });
  }
  const url = render(urlOrObj, { args, data });
  return fetchSingle(page, String(url), method, queryParams, headers, args, data);
}
