/**
 * Pipeline step: fetch — HTTP API requests.
 */

import type { IPage } from '../../types.js';
import { render } from '../template.js';

import { isRecord, mapConcurrent } from '../../utils.js';



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
      throw new Error(`HTTP ${resp.status} ${resp.statusText} from ${finalUrl}`);
    }
    return resp.json();
  }

  const headersJs = JSON.stringify(renderedHeaders);
  const urlJs = JSON.stringify(finalUrl);
  const methodJs = JSON.stringify(method.toUpperCase());
  return page.evaluate(`
    async () => {
      const resp = await fetch(${urlJs}, {
        method: ${methodJs}, headers: ${headersJs}, credentials: "include"
      });
      if (!resp.ok) {
        throw new Error('HTTP ' + resp.status + ' ' + resp.statusText + ' from ' + ${urlJs});
      }
      return await resp.json();
    }
  `);
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
            results[i] = { error: e.message };
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

  // Per-item fetch when data is array and URL references item
  if (Array.isArray(data) && urlTemplate.includes('item')) {
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
      return fetchBatchInBrowser(page, urls, method.toUpperCase(), renderedHeaders, concurrency);
    }

    // Non-browser: use concurrent pool (already optimized)
    return mapConcurrent(data, concurrency, async (item, index) => {
      const itemUrl = String(render(urlTemplate, { args, data, item, index }));
      return fetchSingle(null, itemUrl, method, queryParams, headers, args, data);
    });
  }
  const url = render(urlOrObj, { args, data });
  return fetchSingle(page, String(url), method, queryParams, headers, args, data);
}
