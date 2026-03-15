/**
 * Pipeline step: fetch — HTTP API requests.
 */

import type { IPage } from '../../types.js';
import { render } from '../template.js';

/** Single URL fetch helper */
async function fetchSingle(
  page: IPage | null, url: string, method: string,
  queryParams: Record<string, any>, headers: Record<string, any>,
  args: Record<string, any>, data: any,
): Promise<any> {
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
    return resp.json();
  }

  const headersJs = JSON.stringify(renderedHeaders);
  const escapedUrl = finalUrl.replace(/"/g, '\\"');
  return page.evaluate(`
    async () => {
      const resp = await fetch("${escapedUrl}", {
        method: "${method}", headers: ${headersJs}, credentials: "include"
      });
      return await resp.json();
    }
  `);
}

export async function stepFetch(page: IPage | null, params: any, data: any, args: Record<string, any>): Promise<any> {
  const urlOrObj = typeof params === 'string' ? params : (params?.url ?? '');
  const method = params?.method ?? 'GET';
  const queryParams: Record<string, any> = params?.params ?? {};
  const headers: Record<string, any> = params?.headers ?? {};
  const urlTemplate = String(urlOrObj);

  // Per-item fetch when data is array and URL references item
  if (Array.isArray(data) && urlTemplate.includes('item')) {
    const results: any[] = [];
    for (let i = 0; i < data.length; i++) {
      const itemUrl = String(render(urlTemplate, { args, data, item: data[i], index: i }));
      results.push(await fetchSingle(page, itemUrl, method, queryParams, headers, args, data));
    }
    return results;
  }
  const url = render(urlOrObj, { args, data });
  return fetchSingle(page, String(url), method, queryParams, headers, args, data);
}
