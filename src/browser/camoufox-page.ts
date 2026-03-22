/**
 * CamoufoxPage — implements IPage by talking to Camoufox via playwright-core Juggler protocol.
 *
 * This is a drop-in replacement for the daemon-based Page class.
 * All browser interactions go through Playwright's Firefox protocol (Juggler),
 * which means page.evaluate() bypasses CSP just like CDP does.
 *
 * The DOM snapshot engine, click/type/scroll helpers are reused from the shared
 * dom-snapshot.ts and dom-helpers.ts — same JS code, different transport.
 */

import type { Page as PwPage, BrowserContext } from 'playwright-core';
import type { BrowserCookie, BrowserState, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { formatSnapshot } from '../snapshotFormatter.js';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
} from './dom-helpers.js';

export class CamoufoxPage implements IPage {
  constructor(
    private readonly page: PwPage,
    private readonly context: BrowserContext,
  ) {}

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void> {
    await this.page.goto(url, {
      waitUntil: options?.waitUntil === 'none' ? undefined : 'load',
      timeout: 30000,
    });
    if (options?.waitUntil !== 'none') {
      const settleMs = options?.settleMs ?? 1000;
      await this.page.waitForTimeout(settleMs);
    }
  }

  async evaluate(js: string): Promise<unknown> {
    // Playwright evaluate accepts a function or expression string.
    // Our JS from dom-helpers/dom-snapshot are self-executing expressions,
    // so we pass them directly. Playwright Juggler evaluates in the page context,
    // bypassing CSP.
    return this.page.evaluate(js);
  }

  async getCookies(opts: { domain?: string; url?: string } = {}): Promise<BrowserCookie[]> {
    const urls = opts.url ? [opts.url] : undefined;
    const cookies = await this.context.cookies(urls);
    const filtered = opts.domain
      ? cookies.filter(c => c.domain.includes(opts.domain!))
      : cookies;
    return filtered.map(c => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      expirationDate: c.expires !== -1 ? c.expires : undefined,
    }));
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

    try {
      return await this.page.evaluate(snapshotJs);
    } catch {
      // Fallback: basic snapshot
      const raw = await this.page.evaluate(`
        (function() {
          function buildTree(node, depth) {
            if (depth > 50) return '';
            const role = node.getAttribute?.('role') || node.tagName?.toLowerCase() || 'generic';
            const name = node.getAttribute?.('aria-label') || node.textContent?.trim().slice(0, 80) || '';
            let line = '  '.repeat(depth) + role;
            if (name) line += ' "' + name.replace(/"/g, '\\\\"') + '"';
            let result = line + '\\n';
            if (node.children) { for (const child of node.children) result += buildTree(child, depth + 1); }
            return result;
          }
          return buildTree(document.body, 0);
        })()
      `);
      if (typeof raw === 'string') return formatSnapshot(raw, opts);
      return raw;
    }
  }

  async click(ref: string): Promise<void> {
    await this.page.evaluate(clickJs(ref));
  }

  async typeText(ref: string, text: string): Promise<void> {
    await this.page.evaluate(typeTextJs(ref, text));
  }

  async pressKey(key: string): Promise<void> {
    await this.page.evaluate(pressKeyJs(key));
  }

  async scrollTo(ref: string): Promise<unknown> {
    return this.page.evaluate(scrollToRefJs(ref));
  }

  async getFormState(): Promise<Record<string, unknown>> {
    return (await this.page.evaluate(getFormStateJs())) as Record<string, unknown>;
  }

  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      await this.page.waitForTimeout(options * 1000);
      return;
    }
    if (options.time) {
      await this.page.waitForTimeout(options.time * 1000);
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      await this.page.evaluate(waitForTextJs(options.text, timeout));
    }
  }

  async tabs(): Promise<unknown[]> {
    return this.context.pages().map((p, i) => ({
      index: i,
      url: p.url(),
      title: '', // title() is async, simplify
      active: p === this.page,
    }));
  }

  async closeTab(index?: number): Promise<void> {
    const pages = this.context.pages();
    const target = index !== undefined ? pages[index] : this.page;
    if (target) await target.close();
  }

  async newTab(): Promise<void> {
    await this.context.newPage();
  }

  async selectTab(index: number): Promise<void> {
    const pages = this.context.pages();
    if (pages[index]) await pages[index].bringToFront();
  }

  async networkRequests(includeStatic: boolean = false): Promise<unknown[]> {
    const result = await this.page.evaluate(networkRequestsJs(includeStatic));
    return Array.isArray(result) ? result : [];
  }

  async consoleMessages(_level?: string): Promise<unknown[]> {
    return [];
  }

  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    const buffer = await this.page.screenshot({
      type: options.format ?? 'png',
      quality: options.format === 'jpeg' ? (options.quality ?? 80) : undefined,
      fullPage: options.fullPage ?? false,
    });
    const base64 = buffer.toString('base64');

    if (options.path) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.dirname(options.path);
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(options.path, buffer);
    }

    return base64;
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    await this.page.evaluate(scrollJs(direction, amount));
  }

  async autoScroll(options?: { times?: number; delayMs?: number }): Promise<void> {
    const times = options?.times ?? 3;
    const delayMs = options?.delayMs ?? 2000;
    await this.page.evaluate(autoScrollJs(times, delayMs));
  }

  async installInterceptor(pattern: string): Promise<void> {
    const { generateInterceptorJs } = await import('../interceptor.js');
    await this.page.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<unknown[]> {
    const { generateReadInterceptedJs } = await import('../interceptor.js');
    const result = await this.page.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return Array.isArray(result) ? result : [];
  }

  async exportState(opts: { domain?: string } = {}): Promise<BrowserState> {
    const url = this.page.url();
    let domain = '';
    try { domain = new URL(url).hostname; } catch {}

    // Cookies — via Playwright context API
    const rawCookies = await this.context.cookies(opts.domain ? undefined : [url]);
    const allCookies = opts.domain
      ? rawCookies.filter(c => c.domain.includes(opts.domain!))
      : rawCookies;
    const cookies = allCookies.map(c => ({
      name: c.name, value: c.value, domain: c.domain, path: c.path,
      secure: c.secure, httpOnly: c.httpOnly,
      expirationDate: c.expires !== -1 ? c.expires : undefined,
    }));

    // localStorage
    const localStorage = await this.page.evaluate(`
      (() => {
        try { const r = {}; for (let i = 0; i < window.localStorage.length; i++) { const k = window.localStorage.key(i); if (k) r[k] = window.localStorage.getItem(k); } return r; }
        catch { return {}; }
      })()
    `) as Record<string, string>;

    // sessionStorage
    const sessionStorage = await this.page.evaluate(`
      (() => {
        try { const r = {}; for (let i = 0; i < window.sessionStorage.length; i++) { const k = window.sessionStorage.key(i); if (k) r[k] = window.sessionStorage.getItem(k); } return r; }
        catch { return {}; }
      })()
    `) as Record<string, string>;

    // IndexedDB
    const indexedDB = await this.page.evaluate(`
      (async () => {
        try {
          if (!window.indexedDB || !window.indexedDB.databases) return [];
          const dbs = await window.indexedDB.databases();
          const results = [];
          for (const dbInfo of dbs) {
            if (!dbInfo.name) continue;
            try {
              const db = await new Promise((resolve, reject) => {
                const req = window.indexedDB.open(dbInfo.name, dbInfo.version);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
                req.onupgradeneeded = () => { req.transaction.abort(); reject(new Error('upgrade')); };
              });
              const storeNames = Array.from(db.objectStoreNames);
              const objectStores = [];
              for (const storeName of storeNames) {
                try {
                  const tx = db.transaction(storeName, 'readonly');
                  const store = tx.objectStore(storeName);
                  const records = await new Promise((resolve, reject) => {
                    const allReq = store.getAll();
                    const keysReq = store.getAllKeys();
                    allReq.onsuccess = () => {
                      keysReq.onsuccess = () => {
                        const r = [];
                        for (let i = 0; i < allReq.result.length; i++) r.push({ key: keysReq.result[i], value: allReq.result[i] });
                        resolve(r);
                      };
                      keysReq.onerror = () => resolve([]);
                    };
                    allReq.onerror = () => reject(allReq.error);
                  });
                  objectStores.push({ name: storeName, keyPath: store.keyPath, autoIncrement: store.autoIncrement, records });
                } catch {}
              }
              db.close();
              results.push({ name: dbInfo.name, version: dbInfo.version || 1, objectStores });
            } catch {}
          }
          return results;
        } catch { return []; }
      })()
    `) as BrowserState['indexedDB'];

    return {
      version: 1,
      url,
      domain: opts.domain || domain,
      timestamp: Date.now(),
      cookies,
      localStorage: localStorage ?? {},
      sessionStorage: sessionStorage ?? {},
      indexedDB: indexedDB ?? [],
    };
  }

  async importState(state: BrowserState): Promise<void> {
    // 1. Navigate to target URL
    if (state.url) {
      await this.page.goto(state.url, { waitUntil: 'load', timeout: 30000 });
      await this.page.waitForTimeout(1000);
    }

    // 2. Import cookies via Playwright context API
    if (state.cookies?.length) {
      const pwCookies = state.cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/',
        secure: c.secure ?? false,
        httpOnly: c.httpOnly ?? false,
        expires: c.expirationDate ?? -1,
      }));
      await this.context.addCookies(pwCookies);
    }

    // 3. Import localStorage
    if (state.localStorage && Object.keys(state.localStorage).length > 0) {
      const entries = JSON.stringify(state.localStorage);
      await this.page.evaluate(`(() => { const e = ${entries}; for (const [k,v] of Object.entries(e)) window.localStorage.setItem(k,v); })()`);
    }

    // 4. Import sessionStorage
    if (state.sessionStorage && Object.keys(state.sessionStorage).length > 0) {
      const entries = JSON.stringify(state.sessionStorage);
      await this.page.evaluate(`(() => { const e = ${entries}; for (const [k,v] of Object.entries(e)) window.sessionStorage.setItem(k,v); })()`);
    }

    // 5. Import IndexedDB
    if (state.indexedDB?.length) {
      const idbData = JSON.stringify(state.indexedDB);
      await this.page.evaluate(`
        (async () => {
          const dbs = ${idbData};
          for (const dbInfo of dbs) {
            const db = await new Promise((resolve, reject) => {
              const req = window.indexedDB.open(dbInfo.name, dbInfo.version);
              req.onupgradeneeded = () => {
                const d = req.result;
                for (const s of dbInfo.objectStores) {
                  if (!d.objectStoreNames.contains(s.name)) {
                    d.createObjectStore(s.name, { keyPath: s.keyPath || undefined, autoIncrement: s.autoIncrement });
                  }
                }
              };
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            for (const s of dbInfo.objectStores) {
              if (!db.objectStoreNames.contains(s.name)) continue;
              const tx = db.transaction(s.name, 'readwrite');
              const os = tx.objectStore(s.name);
              for (const r of s.records) os.put(r.value, s.keyPath ? undefined : r.key);
              await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
            }
            db.close();
          }
        })()
      `);
    }

    // 6. Reload to apply cookies
    if (state.cookies?.length) {
      await this.page.reload({ waitUntil: 'load', timeout: 30000 });
      await this.page.waitForTimeout(1000);
    }
  }
}
