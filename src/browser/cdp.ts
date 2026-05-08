/**
 * CDP client — implements IPage by connecting directly to a Chrome/Electron CDP WebSocket.
 *
 * Fixes applied:
 * - send() now has a 30s timeout guard (P0 #4)
 * - goto() waits for Page.loadEventFired instead of hardcoded 1s sleep (P1 #3)
 * - Implemented scroll, autoScroll, screenshot, networkRequests (P1 #2)
 * - Shared DOM helper methods extracted to reduce duplication with Page (P1 #5)
 */

import { WebSocket, type RawData } from 'ws';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { BrowserCookie, IPage, ScreenshotOptions } from '../types.js';
import type { IBrowserFactory } from '../runtime.js';
import { wrapForEval } from './utils.js';
import { generateStealthJs } from './stealth.js';
import { waitForDomStableJs } from './dom-helpers.js';
import { isRecord, saveBase64ToFile } from '../utils.js';
import { getAllElectronApps } from '../electron-apps.js';
import { BasePage } from './base-page.js';

export interface CDPTarget {
  type?: string;
  url?: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

interface RuntimeEvaluateResult {
  result?: {
    value?: unknown;
  };
  exceptionDetails?: {
    exception?: {
      description?: string;
    };
  };
}

const CDP_SEND_TIMEOUT = 30_000;

// Memory guard for in-process capture. The 4k cap we used to apply everywhere
// silently truncated JSON so `JSON.parse` failed or gave partial objects — the
// primary agent-facing bug. Now we keep the full body up to a large cap and
// surface `responseBodyFullSize` + `responseBodyTruncated` so downstream layers
// can tell the agent what happened instead of lying about the payload.
export const CDP_RESPONSE_BODY_CAPTURE_LIMIT = 8 * 1024 * 1024;

export class CDPBridge implements IBrowserFactory {
  private _ws: WebSocket | null = null;
  private _idCounter = 0;
  private _pending = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private _eventListeners = new Map<string, Set<(params: unknown) => void>>();

  async connect(opts?: { timeout?: number; workspace?: string; cdpEndpoint?: string; contextId?: string; idleTimeout?: number }): Promise<IPage> {
    if (this._ws) throw new Error('CDPBridge is already connected. Call close() before reconnecting.');

    const endpoint = opts?.cdpEndpoint ?? process.env.OPENCLI_CDP_ENDPOINT;
    if (!endpoint) throw new Error('CDP endpoint not provided (pass cdpEndpoint or set OPENCLI_CDP_ENDPOINT)');

    let wsUrl = endpoint;
    if (endpoint.startsWith('http')) {
      const targets = await fetchJsonDirect(`${endpoint.replace(/\/$/, '')}/json`) as CDPTarget[];
      const target = selectCDPTarget(targets);
      if (!target || !target.webSocketDebuggerUrl) {
        throw new Error('No inspectable targets found at CDP endpoint');
      }
      wsUrl = target.webSocketDebuggerUrl;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timeoutMs = (opts?.timeout ?? 10) * 1000;
      const timeout = setTimeout(() => {
        this._ws = null;
        ws.close();
        reject(new Error('CDP connect timeout'));
      }, timeoutMs);

      ws.on('open', async () => {
        clearTimeout(timeout);
        this._ws = ws;
        try {
          await this.send('Page.enable');
          await this.send('Page.addScriptToEvaluateOnNewDocument', { source: generateStealthJs() });
        } catch (err) {
          ws.close();
          reject(err instanceof Error ? err : new Error(String(err)));
          return;
        }
        resolve(new CDPPage(this));
      });

      ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      ws.on('message', (data: RawData) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id && this._pending.has(msg.id)) {
            const entry = this._pending.get(msg.id)!;
            clearTimeout(entry.timer);
            this._pending.delete(msg.id);
            if (msg.error) {
              entry.reject(new Error(msg.error.message));
            } else {
              entry.resolve(msg.result);
            }
          }
          if (msg.method) {
            const listeners = this._eventListeners.get(msg.method);
            if (listeners) {
              for (const fn of listeners) fn(msg.params);
            }
          }
        } catch (err) {
          if (process.env.OPENCLI_VERBOSE) {
            // eslint-disable-next-line no-console
            console.error('[cdp] Failed to parse WebSocket message:', err instanceof Error ? err.message : err);
          }
        }
      });
    });
  }

  async close(): Promise<void> {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    for (const p of this._pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error('CDP connection closed'));
    }
    this._pending.clear();
    this._eventListeners.clear();
  }

  async send(method: string, params: Record<string, unknown> = {}, timeoutMs: number = CDP_SEND_TIMEOUT): Promise<unknown> {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error('CDP connection is not open');
    }
    const id = ++this._idCounter;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        reject(new Error(`CDP command '${method}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this._pending.set(id, { resolve, reject, timer });
      this._ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  on(event: string, handler: (params: unknown) => void): void {
    let set = this._eventListeners.get(event);
    if (!set) {
      set = new Set();
      this._eventListeners.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: (params: unknown) => void): void {
    this._eventListeners.get(event)?.delete(handler);
  }

  waitForEvent(event: string, timeoutMs: number = 15_000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(event, handler);
        reject(new Error(`Timed out waiting for CDP event '${event}'`));
      }, timeoutMs);
      const handler = (params: unknown) => {
        clearTimeout(timer);
        this.off(event, handler);
        resolve(params);
      };
      this.on(event, handler);
    });
  }
}

class CDPPage extends BasePage {
  private _pageEnabled = false;

  // Network capture state (mirrors extension/src/cdp.ts NetworkCaptureEntry shape)
  private _networkCapturing = false;
  private _networkCapturePattern = '';
  private _networkEntries: Array<{
    url: string; method: string; responseStatus?: number;
    responseContentType?: string;
    responsePreview?: string;
    responseBodyFullSize?: number;
    responseBodyTruncated?: boolean;
    timestamp: number;
  }> = [];
  private _pendingRequests = new Map<string, number>(); // requestId → index in _networkEntries
  private _pendingBodyFetches: Set<Promise<void>> = new Set(); // track in-flight getResponseBody calls
  private _consoleMessages: Array<{ type: string; text: string; timestamp: number }> = [];
  private _consoleCapturing = false;

  constructor(private bridge: CDPBridge) {
    super();
  }

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number; allowBoundNavigation?: boolean }): Promise<void> {
    if (!this._pageEnabled) {
      await this.bridge.send('Page.enable');
      this._pageEnabled = true;
    }
    const loadPromise = this.bridge.waitForEvent('Page.loadEventFired', 30_000).catch(() => {});
    await this.bridge.send('Page.navigate', { url });
    await loadPromise;
    this._lastUrl = url;
    if (options?.waitUntil !== 'none') {
      const maxMs = options?.settleMs ?? 1000;
      await this.evaluate(waitForDomStableJs(maxMs, Math.min(500, maxMs)));
    }
  }

  async evaluate(js: string): Promise<unknown> {
    const expression = wrapForEval(js);
    const result = await this.bridge.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    }) as RuntimeEvaluateResult;
    if (result.exceptionDetails) {
      throw new Error('Evaluate error: ' + (result.exceptionDetails.exception?.description || 'Unknown exception'));
    }
    return result.result?.value;
  }

  async getCookies(opts: { domain?: string; url?: string } = {}): Promise<BrowserCookie[]> {
    const result = await this.bridge.send('Network.getCookies', opts.url ? { urls: [opts.url] } : {});
    const cookies = isRecord(result) && Array.isArray(result.cookies) ? result.cookies : [];
    const domain = opts.domain;
    return domain
      ? cookies.filter((cookie): cookie is BrowserCookie => isCookie(cookie) && matchesCookieDomain(cookie.domain, domain))
      : cookies;
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    const fullPage = options.fullPage === true;
    const overrideWidth = options.width && options.width > 0 ? Math.ceil(options.width) : undefined;
    // height is ignored under fullPage so the captureBeyondViewport path stays unchanged for users who pass --height alongside --full-page.
    const overrideHeight = !fullPage && options.height && options.height > 0 ? Math.ceil(options.height) : undefined;
    const needsOverride = overrideWidth !== undefined || overrideHeight !== undefined;

    if (needsOverride) {
      if (overrideWidth !== undefined && fullPage) {
        await this.bridge.send('Emulation.setDeviceMetricsOverride', {
          mobile: false,
          width: overrideWidth,
          height: 0,
          deviceScaleFactor: 1,
        });
      }
      let finalWidth = overrideWidth ?? 0;
      let finalHeight = overrideHeight ?? 0;
      if (fullPage) {
        const metrics = await this.bridge.send('Page.getLayoutMetrics');
        const m = isRecord(metrics) ? metrics : {};
        const css = isRecord(m.cssContentSize) ? m.cssContentSize : undefined;
        const fb = isRecord(m.contentSize) ? m.contentSize : undefined;
        const size = css ?? fb;
        if (size && typeof size.width === 'number' && typeof size.height === 'number') {
          if (finalWidth === 0) finalWidth = Math.ceil(size.width);
          finalHeight = Math.ceil(size.height);
        }
      }
      await this.bridge.send('Emulation.setDeviceMetricsOverride', {
        mobile: false,
        width: finalWidth,
        height: finalHeight,
        deviceScaleFactor: 1,
      });
    }

    try {
      const result = await this.bridge.send('Page.captureScreenshot', {
        format: options.format ?? 'png',
        quality: options.format === 'jpeg' ? (options.quality ?? 80) : undefined,
        captureBeyondViewport: !needsOverride && fullPage,
      });
      const base64 = isRecord(result) && typeof result.data === 'string' ? result.data : '';
      if (options.path) {
        await saveBase64ToFile(base64, options.path);
      }
      return base64;
    } finally {
      if (needsOverride) {
        await this.bridge.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
      }
    }
  }

  async startNetworkCapture(pattern: string = ''): Promise<boolean> {
    // Always update the filter pattern
    this._networkCapturePattern = pattern;

    // Reset state only on first start; avoid wiping entries if already capturing
    if (!this._networkCapturing) {
      this._networkEntries = [];
      this._pendingRequests.clear();
      this._pendingBodyFetches.clear();
      await this.bridge.send('Network.enable');

      // Step 1: Record request method/url on requestWillBeSent
      this.bridge.on('Network.requestWillBeSent', (params: unknown) => {
        const p = params as { requestId: string; request: { method: string; url: string }; timestamp: number };
        if (!this._networkCapturePattern || p.request.url.includes(this._networkCapturePattern)) {
          const idx = this._networkEntries.push({
            url: p.request.url,
            method: p.request.method,
            timestamp: Date.now(),
          }) - 1;
          this._pendingRequests.set(p.requestId, idx);
        }
      });

      // Step 2: Fill in response metadata on responseReceived
      this.bridge.on('Network.responseReceived', (params: unknown) => {
        const p = params as { requestId: string; response: { status: number; mimeType?: string } };
        const idx = this._pendingRequests.get(p.requestId);
        if (idx !== undefined) {
          this._networkEntries[idx].responseStatus = p.response.status;
          this._networkEntries[idx].responseContentType = p.response.mimeType || '';
        }
      });

      // Step 3: Fetch body on loadingFinished (body is only reliably available after this)
      this.bridge.on('Network.loadingFinished', (params: unknown) => {
        const p = params as { requestId: string };
        const idx = this._pendingRequests.get(p.requestId);
        if (idx !== undefined) {
          const bodyFetch = this.bridge.send('Network.getResponseBody', { requestId: p.requestId }).then((result: unknown) => {
            const r = result as { body?: string; base64Encoded?: boolean } | undefined;
            if (typeof r?.body === 'string') {
              const fullSize = r.body.length;
              const truncated = fullSize > CDP_RESPONSE_BODY_CAPTURE_LIMIT;
              const body = truncated ? r.body.slice(0, CDP_RESPONSE_BODY_CAPTURE_LIMIT) : r.body;
              this._networkEntries[idx].responsePreview = r.base64Encoded ? `base64:${body}` : body;
              this._networkEntries[idx].responseBodyFullSize = fullSize;
              this._networkEntries[idx].responseBodyTruncated = truncated;
            }
          }).catch((err) => {
            // Body unavailable for some requests (e.g. uploads) — non-fatal
            if (process.env.OPENCLI_VERBOSE) {
              // eslint-disable-next-line no-console
              console.error(`[cdp] getResponseBody failed for ${p.requestId}:`, err instanceof Error ? err.message : err);
            }
          }).finally(() => {
            this._pendingBodyFetches.delete(bodyFetch);
          });
          this._pendingBodyFetches.add(bodyFetch);
          this._pendingRequests.delete(p.requestId);
        }
      });

      this._networkCapturing = true;
    }
    return true;
  }

  async readNetworkCapture(): Promise<unknown[]> {
    // Await all in-flight body fetches so entries have responsePreview populated
    if (this._pendingBodyFetches.size > 0) {
      await Promise.all([...this._pendingBodyFetches]);
    }
    const entries = [...this._networkEntries];
    this._networkEntries = [];
    return entries;
  }

  async consoleMessages(level: string = 'all'): Promise<Array<{ type: string; text: string; timestamp: number }>> {
    if (!this._consoleCapturing) {
      await this.bridge.send('Runtime.enable');
      this.bridge.on('Runtime.consoleAPICalled', (params: unknown) => {
        const p = params as { type: string; args: Array<{ value?: unknown; description?: string }>; timestamp: number };
        const text = (p.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ');
        this._consoleMessages.push({ type: p.type, text, timestamp: Date.now() });
        if (this._consoleMessages.length > 500) this._consoleMessages.shift();
      });
      // Capture uncaught exceptions as error-level messages
      this.bridge.on('Runtime.exceptionThrown', (params: unknown) => {
        const p = params as { timestamp: number; exceptionDetails?: { exception?: { description?: string }; text?: string } };
        const desc = p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'Unknown exception';
        this._consoleMessages.push({ type: 'error', text: desc, timestamp: Date.now() });
        if (this._consoleMessages.length > 500) this._consoleMessages.shift();
      });
      this._consoleCapturing = true;
    }
    if (level === 'all') return [...this._consoleMessages];
    // 'error' level includes both console.error() and uncaught exceptions
    if (level === 'error') return this._consoleMessages.filter(m => m.type === 'error' || m.type === 'warning');
    return this._consoleMessages.filter(m => m.type === level);
  }

  async tabs(): Promise<unknown[]> {
    return [];
  }

  async selectTab(_target: number | string): Promise<void> {
    // Not supported in direct CDP mode
  }

  async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.bridge.send(method, params);
  }

  async handleJavaScriptDialog(accept: boolean, promptText?: string): Promise<void> {
    await this.cdp('Page.handleJavaScriptDialog', {
      accept,
      ...(promptText !== undefined && { promptText }),
    });
  }

  async nativeClick(x: number, y: number): Promise<void> {
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x,
      y,
    });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  }

  async nativeType(text: string): Promise<void> {
    await this.cdp('Input.insertText', { text });
  }

  async insertText(text: string): Promise<void> {
    await this.nativeType(text);
  }

  async nativeKeyPress(key: string, modifiers: string[] = []): Promise<void> {
    let modifierFlags = 0;
    for (const mod of modifiers) {
      if (mod === 'Alt') modifierFlags |= 1;
      if (mod === 'Ctrl' || mod === 'Control') modifierFlags |= 2;
      if (mod === 'Meta') modifierFlags |= 4;
      if (mod === 'Shift') modifierFlags |= 8;
    }
    await this.cdp('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      modifiers: modifierFlags,
    });
    await this.cdp('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      modifiers: modifierFlags,
    });
  }
}

function isCookie(value: unknown): value is BrowserCookie {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.value === 'string'
    && typeof value.domain === 'string';
}

function matchesCookieDomain(cookieDomain: string, targetDomain: string): boolean {
  const normalizedCookieDomain = cookieDomain.replace(/^\./, '').toLowerCase();
  const normalizedTargetDomain = targetDomain.replace(/^\./, '').toLowerCase();
  return normalizedTargetDomain === normalizedCookieDomain
    || normalizedTargetDomain.endsWith(`.${normalizedCookieDomain}`);
}

function selectCDPTarget(targets: CDPTarget[]): CDPTarget | undefined {
  const preferredPattern = compilePreferredPattern(process.env.OPENCLI_CDP_TARGET);

  const ranked = targets
    .map((target, index) => ({ target, index, score: scoreCDPTarget(target, preferredPattern) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    });

  return ranked[0]?.target;
}

function scoreCDPTarget(target: CDPTarget, preferredPattern?: RegExp): number {
  if (!target.webSocketDebuggerUrl) return Number.NEGATIVE_INFINITY;

  const type = (target.type ?? '').toLowerCase();
  const url = (target.url ?? '').toLowerCase();
  const title = (target.title ?? '').toLowerCase();
  const haystack = `${title} ${url}`;

  if (!haystack.trim() && !type) return Number.NEGATIVE_INFINITY;
  if (haystack.includes('devtools')) return Number.NEGATIVE_INFINITY;
  if (type === 'background_page' || type === 'service_worker') return Number.NEGATIVE_INFINITY;

  let score = 0;

  if (preferredPattern && preferredPattern.test(haystack)) score += 1000;

  if (type === 'app') score += 120;
  else if (type === 'webview') score += 100;
  else if (type === 'page') score += 80;
  else if (type === 'iframe') score += 20;

  if (url.startsWith('http://localhost') || url.startsWith('https://localhost')) score += 90;
  if (url.startsWith('file://')) score += 60;
  if (url.startsWith('http://127.0.0.1') || url.startsWith('https://127.0.0.1')) score += 50;
  if (url.startsWith('about:blank')) score -= 120;
  if (url === '' || url === 'about:blank') score -= 40;

  if (title && title !== 'devtools') score += 25;

  // Boost score for known Electron app names from the registry (builtin + user-defined)
  const appNames = Object.values(getAllElectronApps()).map(a => (a.displayName ?? a.processName).toLowerCase());
  for (const name of appNames) {
    if (title.includes(name)) { score += 120; break; }
  }
  for (const name of appNames) {
    if (url.includes(name)) { score += 100; break; }
  }

  return score;
}

function compilePreferredPattern(raw: string | undefined): RegExp | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  return new RegExp(escapeRegExp(value.toLowerCase()));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const __test__ = {
  selectCDPTarget,
  scoreCDPTarget,
};

function fetchJsonDirect(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = (parsed.protocol === 'https:' ? httpsRequest : httpRequest)(parsed, (res) => {
      const statusCode = res.statusCode ?? 0;
      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`Failed to fetch CDP targets: HTTP ${statusCode}`));
        return;
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });

    request.on('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('Timed out fetching CDP targets')));
    request.end();
  });
}
