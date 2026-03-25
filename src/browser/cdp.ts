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
import type { BrowserCookie, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { wrapForEval } from './utils.js';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';
import { generateStealthJs } from './stealth.js';
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
import { isRecord, saveBase64ToFile } from '../utils.js';

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

export class CDPBridge {
  private _ws: WebSocket | null = null;
  private _idCounter = 0;
  private _pending = new Map<number, { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private _eventListeners = new Map<string, Set<(params: unknown) => void>>();

  async connect(opts?: { timeout?: number; workspace?: string }): Promise<IPage> {
    if (this._ws) throw new Error('CDPBridge is already connected. Call close() before reconnecting.');

    const endpoint = process.env.OPENCLI_CDP_ENDPOINT;
    if (!endpoint) throw new Error('OPENCLI_CDP_ENDPOINT is not set');

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
      const timeout = setTimeout(() => reject(new Error('CDP connect timeout')), timeoutMs);

      ws.on('open', async () => {
        clearTimeout(timeout);
        this._ws = ws;
        try {
          await this.send('Page.enable');
          await this.send('Page.addScriptToEvaluateOnNewDocument', { source: generateStealthJs() });
        } catch {}
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
        } catch {}
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

class CDPPage implements IPage {
  private _pageEnabled = false;
  constructor(private bridge: CDPBridge) {}

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void> {
    if (!this._pageEnabled) {
      await this.bridge.send('Page.enable');
      this._pageEnabled = true;
    }
    const loadPromise = this.bridge.waitForEvent('Page.loadEventFired', 30_000).catch(() => {});
    await this.bridge.send('Page.navigate', { url });
    await loadPromise;
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

  async snapshot(opts: SnapshotOptions = {}): Promise<unknown> {
    const snapshotJs = generateSnapshotJs({
      viewportExpand: opts.viewportExpand ?? 800,
      maxDepth: Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200)),
      interactiveOnly: opts.interactive ?? false,
      maxTextLength: opts.maxTextLength ?? 120,
      includeScrollInfo: true,
      bboxDedup: true,
    });
    return this.evaluate(snapshotJs);
  }

  async click(ref: string): Promise<void> {
    await this.evaluate(clickJs(ref));
  }

  async typeText(ref: string, text: string): Promise<void> {
    await this.evaluate(typeTextJs(ref, text));
  }

  async pressKey(key: string): Promise<void> {
    await this.evaluate(pressKeyJs(key));
  }

  async scrollTo(ref: string): Promise<unknown> {
    return this.evaluate(scrollToRefJs(ref));
  }

  async getFormState(): Promise<Record<string, unknown>> {
    return (await this.evaluate(getFormStateJs())) as Record<string, unknown>;
  }

  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      await new Promise((resolve) => setTimeout(resolve, options * 1000));
      return;
    }
    if (typeof options.time === 'number') {
      const waitTime = options.time;
      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      await this.evaluate(waitForTextJs(options.text, timeout));
    }
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    await this.evaluate(scrollJs(direction, amount));
  }

  async autoScroll(options?: { times?: number; delayMs?: number }): Promise<void> {
    const times = options?.times ?? 3;
    const delayMs = options?.delayMs ?? 2000;
    await this.evaluate(autoScrollJs(times, delayMs));
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    const result = await this.bridge.send('Page.captureScreenshot', {
      format: options.format ?? 'png',
      quality: options.format === 'jpeg' ? (options.quality ?? 80) : undefined,
      captureBeyondViewport: options.fullPage ?? false,
    });
    const base64 = isRecord(result) && typeof result.data === 'string' ? result.data : '';
    if (options.path) {
      await saveBase64ToFile(base64, options.path);
    }
    return base64;
  }

  async networkRequests(includeStatic: boolean = false): Promise<unknown[]> {
    const result = await this.evaluate(networkRequestsJs(includeStatic));
    return Array.isArray(result) ? result : [];
  }

  async tabs(): Promise<unknown[]> {
    return [];
  }

  async closeTab(_index?: number): Promise<void> {
    // Not supported in direct CDP mode
  }

  async newTab(): Promise<void> {
    await this.bridge.send('Target.createTarget', { url: 'about:blank' });
  }

  async selectTab(_index: number): Promise<void> {
    // Not supported in direct CDP mode
  }

  async consoleMessages(_level?: string): Promise<unknown[]> {
    return [];
  }

  async installInterceptor(pattern: string): Promise<void> {
    const { generateInterceptorJs } = await import('../interceptor.js');
    await this.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<unknown[]> {
    const { generateReadInterceptedJs } = await import('../interceptor.js');
    const result = await this.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return Array.isArray(result) ? result : [];
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
  if (title.includes('antigravity')) score += 120;
  if (title.includes('codex')) score += 120;
  if (title.includes('cursor')) score += 120;
  if (title.includes('chatwise')) score += 120;
  if (title.includes('notion')) score += 120;
  if (title.includes('discord')) score += 120;

  if (url.includes('antigravity')) score += 100;
  if (url.includes('codex')) score += 100;
  if (url.includes('cursor')) score += 100;
  if (url.includes('chatwise')) score += 100;
  if (url.includes('notion')) score += 100;
  if (url.includes('discord')) score += 100;

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
