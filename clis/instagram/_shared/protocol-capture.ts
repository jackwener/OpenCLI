import * as fs from 'node:fs';

import type { BrowserCookie, IPage } from '../../../src/types.js';
import { resolveInstagramRuntimeInfo } from './runtime-info.js';

const DEFAULT_CAPTURE_VAR = '__opencli_ig_protocol_capture';
const DEFAULT_CAPTURE_ERRORS_VAR = '__opencli_ig_protocol_capture_errors';
const TRACE_OUTPUT_PATH = '/tmp/instagram_post_protocol_trace.json';
const INSTAGRAM_PROTOCOL_CAPTURE_PATTERN = [
  '/rupload_igphoto/',
  '/rupload_igvideo/',
  '/api/v1/',
  '/media/configure/',
  '/media/configure_sidecar/',
  '/media/configure_to_story/',
  '/api/graphql/',
].join('|');

export interface InstagramProtocolCaptureEntry {
  kind: 'fetch' | 'xhr';
  url: string;
  method: string;
  requestHeaders?: Record<string, string>;
  requestBodyKind?: string;
  requestBodyPreview?: string;
  responseStatus?: number;
  responseContentType?: string;
  responsePreview?: string;
  timestamp: number;
}

export function buildInstallInstagramProtocolCaptureJs(
  captureVar: string = DEFAULT_CAPTURE_VAR,
  captureErrorsVar: string = DEFAULT_CAPTURE_ERRORS_VAR,
): string {
  return `
    (() => {
      const CAPTURE_VAR = ${JSON.stringify(captureVar)};
      const CAPTURE_ERRORS_VAR = ${JSON.stringify(captureErrorsVar)};
      const PATCH_GUARD = CAPTURE_VAR + '_patched';
      const FILTERS = [
        '/rupload_igphoto/',
        '/rupload_igvideo/',
        '/api/v1/',
        '/media/configure/',
        '/media/configure_sidecar/',
        '/media/configure_to_story/',
        '/api/graphql/',
      ];

      const shouldCapture = (url) => {
        const value = String(url || '');
        return FILTERS.some((filter) => value.includes(filter));
      };

      const normalizeHeaders = (headersLike) => {
        const out = {};
        try {
          if (!headersLike) return out;
          if (headersLike instanceof Headers) {
            headersLike.forEach((value, key) => { out[key] = value; });
            return out;
          }
          if (Array.isArray(headersLike)) {
            for (const pair of headersLike) {
              if (Array.isArray(pair) && pair.length >= 2) out[String(pair[0])] = String(pair[1]);
            }
            return out;
          }
          if (typeof headersLike === 'object') {
            for (const [key, value] of Object.entries(headersLike)) out[key] = String(value);
          }
        } catch {}
        return out;
      };

      const summarizeBody = async (body) => {
        if (body == null) return { kind: 'empty', preview: '' };
        try {
          if (typeof body === 'string') {
            return { kind: 'string', preview: body.slice(0, 1000) };
          }
          if (body instanceof URLSearchParams) {
            return { kind: 'urlencoded', preview: body.toString().slice(0, 1000) };
          }
          if (body instanceof FormData) {
            const parts = [];
            for (const [key, value] of body.entries()) {
              if (value instanceof File) {
                parts.push(key + '=File(' + value.name + ',' + value.type + ',' + value.size + ')');
              } else {
                parts.push(key + '=' + String(value));
              }
            }
            return { kind: 'formdata', preview: parts.join('&').slice(0, 2000) };
          }
          if (body instanceof Blob) {
            return { kind: 'blob', preview: 'Blob(' + body.type + ',' + body.size + ')' };
          }
          if (body instanceof ArrayBuffer) {
            return { kind: 'arraybuffer', preview: 'ArrayBuffer(' + body.byteLength + ')' };
          }
          if (ArrayBuffer.isView(body)) {
            return { kind: 'typed-array', preview: body.constructor.name + '(' + body.byteLength + ')' };
          }
          return { kind: typeof body, preview: String(body).slice(0, 1000) };
        } catch (error) {
          return { kind: 'unknown', preview: 'body-preview-error:' + String(error) };
        }
      };

      const capture = async (kind, url, method, headers, body, response) => {
        if (!shouldCapture(url)) return;
        try {
          const bodyInfo = await summarizeBody(body);
          const contentType = response?.headers?.get?.('content-type') || '';
          let responsePreview = '';
          try {
            if (response && typeof response.clone === 'function') {
              const clone = response.clone();
              responsePreview = (await clone.text()).slice(0, 4000);
            }
          } catch (error) {
            responsePreview = 'response-preview-error:' + String(error);
          }
          window[CAPTURE_VAR].push({
            kind,
            url: String(url || ''),
            method: String(method || 'GET').toUpperCase(),
            requestHeaders: normalizeHeaders(headers),
            requestBodyKind: bodyInfo.kind,
            requestBodyPreview: bodyInfo.preview,
            responseStatus: response?.status,
            responseContentType: contentType,
            responsePreview,
            timestamp: Date.now(),
          });
        } catch (error) {
          window[CAPTURE_ERRORS_VAR].push(String(error));
        }
      };

      if (!Array.isArray(window[CAPTURE_VAR])) window[CAPTURE_VAR] = [];
      if (!Array.isArray(window[CAPTURE_ERRORS_VAR])) window[CAPTURE_ERRORS_VAR] = [];
      if (window[PATCH_GUARD]) return { ok: true };

      const origFetch = window.fetch;
      window.fetch = async function(...args) {
        const input = args[0];
        const init = args[1] || {};
        const url = typeof input === 'string'
          ? input
          : input instanceof Request
            ? input.url
            : String(input || '');
        const method = init.method || (input instanceof Request ? input.method : 'GET');
        const headers = init.headers || (input instanceof Request ? input.headers : undefined);
        const body = init.body || (input instanceof Request ? input.body : undefined);
        const response = await origFetch.apply(this, args);
        capture('fetch', url, method, headers, body, response);
        return response;
      };

      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

      XMLHttpRequest.prototype.open = function(method, url) {
        this.__opencli_method = method;
        this.__opencli_url = url;
        this.__opencli_headers = {};
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        try {
          this.__opencli_headers = this.__opencli_headers || {};
          this.__opencli_headers[String(name)] = String(value);
        } catch {}
        return origSetRequestHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        this.addEventListener('load', () => {
          if (!shouldCapture(this.__opencli_url)) return;
          try {
            window[CAPTURE_VAR].push({
              kind: 'xhr',
              url: String(this.__opencli_url || ''),
              method: String(this.__opencli_method || 'GET').toUpperCase(),
              requestHeaders: this.__opencli_headers || {},
              requestBodyKind: body == null ? 'empty' : (body instanceof FormData ? 'formdata' : typeof body),
              requestBodyPreview: body == null ? '' : (body instanceof FormData ? '[formdata]' : String(body).slice(0, 2000)),
              responseStatus: this.status,
              responseContentType: this.getResponseHeader('content-type') || '',
              responsePreview: String(this.responseText || '').slice(0, 4000),
              timestamp: Date.now(),
            });
          } catch (error) {
            window[CAPTURE_ERRORS_VAR].push(String(error));
          }
        });
        return origSend.apply(this, arguments);
      };

      window[PATCH_GUARD] = true;
      return { ok: true };
    })()
  `;
}

export function buildReadInstagramProtocolCaptureJs(
  captureVar: string = DEFAULT_CAPTURE_VAR,
  captureErrorsVar: string = DEFAULT_CAPTURE_ERRORS_VAR,
): string {
  return `
    (() => {
      const data = Array.isArray(window[${JSON.stringify(captureVar)}]) ? window[${JSON.stringify(captureVar)}] : [];
      const errors = Array.isArray(window[${JSON.stringify(captureErrorsVar)}]) ? window[${JSON.stringify(captureErrorsVar)}] : [];
      window[${JSON.stringify(captureVar)}] = [];
      window[${JSON.stringify(captureErrorsVar)}] = [];
      return { data, errors };
    })()
  `;
}

export async function installInstagramProtocolCapture(page: IPage): Promise<void> {
  if (typeof page.startNetworkCapture === 'function') {
    try {
      await page.startNetworkCapture(INSTAGRAM_PROTOCOL_CAPTURE_PATTERN);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Unknown action') && !message.includes('network-capture')) {
        throw error;
      }
    }
  }
  await page.evaluate(buildInstallInstagramProtocolCaptureJs());
}

export async function readInstagramProtocolCapture(page: IPage): Promise<{
  data: InstagramProtocolCaptureEntry[];
  errors: string[];
}> {
  if (typeof page.readNetworkCapture === 'function') {
    try {
      const data = await page.readNetworkCapture();
      return {
        data: Array.isArray(data) ? data as InstagramProtocolCaptureEntry[] : [],
        errors: [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Unknown action') && !message.includes('network-capture')) {
        throw error;
      }
    }
  }
  const result = await page.evaluate(buildReadInstagramProtocolCaptureJs()) as {
    data?: InstagramProtocolCaptureEntry[];
    errors?: string[];
  };
  return {
    data: Array.isArray(result?.data) ? result.data : [],
    errors: Array.isArray(result?.errors) ? result.errors : [],
  };
}

export async function dumpInstagramProtocolCaptureIfEnabled(page: IPage): Promise<void> {
  if (process.env.OPENCLI_INSTAGRAM_CAPTURE !== '1') return;
  const payload = await readInstagramProtocolCapture(page);
  fs.writeFileSync(TRACE_OUTPUT_PATH, JSON.stringify(payload, null, 2));
}

function buildCookieHeader(cookies: BrowserCookie[]): string {
  return cookies
    .filter((cookie) => cookie?.name && cookie?.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

export async function instagramPrivateApiFetch(
  page: IPage,
  input: string | URL,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<Response> {
  const url = String(input);
  const [urlCookies, domainCookies] = await Promise.all([
    page.getCookies({ url }),
    page.getCookies({ domain: 'instagram.com' }),
  ]);
  const merged = new Map<string, BrowserCookie>();
  for (const cookie of domainCookies) merged.set(cookie.name, cookie);
  for (const cookie of urlCookies) merged.set(cookie.name, cookie);
  const cookieHeader = buildCookieHeader(Array.from(merged.values()));
  const csrf = merged.get('csrftoken')?.value || '';
  const initHeaders = init.headers ?? {};
  const requestedAppIdHeader = Object.entries(initHeaders).find(([key]) => key.toLowerCase() === 'x-ig-app-id')?.[1] || '';
  const runtimeInfo = requestedAppIdHeader ? null : await resolveInstagramRuntimeInfo(page);
  const appId = requestedAppIdHeader || runtimeInfo?.appId || '';
  const hasContentType = Object.keys(init.headers ?? {}).some((key) => key.toLowerCase() === 'content-type');

  return fetch(url, {
    method: init.method ?? 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'X-CSRFToken': csrf,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://www.instagram.com',
      'Referer': 'https://www.instagram.com/',
      ...(appId ? { 'X-IG-App-ID': appId } : {}),
      ...(cookieHeader ? { 'Cookie': cookieHeader } : {}),
      ...(typeof init.body === 'string' && !hasContentType ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      ...initHeaders,
    },
    ...(init.body !== undefined ? { body: init.body as BodyInit } : {}),
  });
}
