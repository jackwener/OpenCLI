/**
 * Pipeline step: fetch — HTTP API requests.
 */

import { ArgumentError, CliError, getErrorMessage } from '../../errors.js';
import { log } from '../../logger.js';
import type { IPage } from '../../types.js';
import { render, type RenderContext } from '../template.js';

import { isRecord, mapConcurrent } from '../../utils.js';

interface FetchRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Render template containers without interpreting strings returned by expressions. */
function renderBody(value: unknown, ctx: RenderContext, ancestors = new Set<object>()): unknown {
  if (!Array.isArray(value) && !isRecord(value)) return render(value, ctx);
  if (ancestors.has(value)) throw new ArgumentError('Fetch body must not contain circular references.');
  ancestors.add(value);
  try {
    return Array.isArray(value)
      ? value.map(item => renderBody(item, ctx, ancestors))
      : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, renderBody(item, ctx, ancestors)]));
  } finally {
    ancestors.delete(value);
  }
}

function prepareRequest(
  urlTemplate: string, method: string, params: Record<string, unknown>, ctx: RenderContext,
): FetchRequest {
  const queryParams = isRecord(params.params) ? params.params : {};
  const headers = isRecord(params.headers) ? params.headers : {};
  const renderedParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(queryParams)) renderedParams[k] = String(render(v, ctx));
  const renderedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) renderedHeaders[k] = String(render(v, ctx));

  let url = String(render(urlTemplate, ctx));
  if (Object.keys(renderedParams).length > 0) {
    const qs = new URLSearchParams(renderedParams).toString();
    const fragmentAt = url.indexOf('#');
    const base = fragmentAt < 0 ? url : url.slice(0, fragmentAt);
    const fragment = fragmentAt < 0 ? '' : url.slice(fragmentAt);
    url = `${base}${base.includes('?') ? '&' : '?'}${qs}${fragment}`;
  }

  const request: FetchRequest = { url, method, headers: renderedHeaders };
  if ('body' in params) {
    try {
      request.body = JSON.stringify(renderBody(params.body, ctx));
    } catch (error) {
      if (error instanceof ArgumentError) throw error;
      throw new ArgumentError('Fetch body must be JSON-serializable.', getErrorMessage(error));
    }
    if (request.body === undefined) {
      throw new ArgumentError('Fetch body must resolve to a JSON value, not undefined.');
    }
    if (!Object.keys(renderedHeaders).some(key => key.toLowerCase() === 'content-type')) {
      renderedHeaders['Content-Type'] = 'application/json';
    }
  }
  return request;
}

/** Single URL fetch helper. Browser fetchJson accepts JSON values, Node accepts bytes. */
async function fetchSingle(page: IPage | null, request: FetchRequest): Promise<unknown> {
  const { url, method, headers, body } = request;
  if (page === null) {
    const resp = await fetch(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    if (!resp.ok) {
      throw new CliError('FETCH_ERROR', `HTTP ${resp.status} ${resp.statusText} from ${url}`);
    }
    return resp.json();
  }

  return page.fetchJson(url, { method, headers, ...(body !== undefined ? { body: JSON.parse(body) } : {}) });
}

/**
 * Batch fetch: send prepared requests into the browser as a single evaluate() call.
 * This eliminates N-1 cross-process IPC round trips, performing all fetches
 * inside the V8 engine and returning results as one JSON array.
 */
async function fetchBatchInBrowser(
  page: IPage, requests: FetchRequest[], concurrency: number,
): Promise<unknown[]> {
  return (await page.evaluate(`
    async () => {
      const requests = JSON.parse(${JSON.stringify(JSON.stringify(requests))});
      const concurrency = ${concurrency};

      const results = new Array(requests.length);
      let idx = 0;

      async function worker() {
        while (idx < requests.length) {
          const i = idx++;
          const { url, method, headers, body } = requests[i];
          try {
            const resp = await fetch(url, {
              method, headers, credentials: "include",
              ...(body !== undefined ? { body } : {}),
            });
            if (!resp.ok) {
              throw new Error('HTTP ' + resp.status + ' ' + resp.statusText + ' from ' + url);
            }
            results[i] = await resp.json();
          } catch (e) {
            results[i] = { error: e instanceof Error ? e.message : String(e) };
            // Note: getErrorMessage() is a Node.js utility — can't use it inside evaluate()
          }
        }
      }

      const workers = Array.from({ length: Math.min(concurrency, requests.length) }, () => worker());
      await Promise.all(workers);
      return results;
    }
  `)) as unknown[];
}

export async function stepFetch(page: IPage | null, params: unknown, data: unknown, args: Record<string, unknown>): Promise<unknown> {
  const paramObject = isRecord(params) ? params : {};
  const urlOrObj = typeof params === 'string' ? params : (paramObject.url ?? '');
  const method = typeof paramObject.method === 'string' ? paramObject.method.toUpperCase() : 'GET';
  const urlTemplate = String(urlOrObj);
  if ('body' in paramObject && (method === 'GET' || method === 'HEAD')) {
    throw new ArgumentError(`Fetch body is not supported for ${method}. Set method to POST, PUT, PATCH, or DELETE.`);
  }
  if (paramObject.forEach !== undefined && typeof paramObject.forEach !== 'boolean') {
    throw new ArgumentError('Fetch forEach must be a boolean.');
  }
  if (paramObject.forEach === true && !Array.isArray(data)) {
    throw new ArgumentError('Fetch forEach requires array data from the preceding step.');
  }

  // Explicit batching also supports fixed endpoints with per-item JSON bodies.
  const forEach = paramObject.forEach ?? urlTemplate.includes('item');
  if (Array.isArray(data) && forEach) {
    const concurrency = typeof paramObject.concurrency === 'number' ? paramObject.concurrency : 5;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new ArgumentError(`Concurrency limit must be a positive integer. Received: "${String(concurrency)}"`);
    }

    // Serialize every body before issuing requests to avoid partially sending an invalid batch.
    const requests = data.map((item, index) => prepareRequest(urlTemplate, method, paramObject, { args, data, item, index }));
    if (requests.length === 0) return [];

    // BATCH IPC: if browser is available, batch all fetches into a single evaluate() call
    if (page !== null) {
      const results = await fetchBatchInBrowser(page, requests, concurrency);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r && typeof r === 'object' && 'error' in r) {
          log.warn(`Batch fetch failed for ${requests[i].url}: ${(r as { error: string }).error}`);
        }
      }
      return results;
    }

    // Non-browser: use concurrent pool (already optimized)
    return mapConcurrent(requests, concurrency, async (request) => {
      try {
        return await fetchSingle(null, request);
      } catch (error) {
        const message = getErrorMessage(error);
        log.warn(`Batch fetch failed for ${request.url}: ${message}`);
        return { error: message };
      }
    });
  }
  return fetchSingle(page, prepareRequest(urlTemplate, method, paramObject, { args, data }));
}
