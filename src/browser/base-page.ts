/**
 * BasePage — shared IPage method implementations for DOM helpers.
 *
 * Both Page (daemon-backed) and CDPPage (direct CDP) execute JS the same way
 * for DOM operations. This base class deduplicates ~200 lines of identical
 * click/type/scroll/wait/snapshot/interceptor methods.
 *
 * Subclasses implement the transport-specific methods: goto, evaluate,
 * getCookies, screenshot, tabs, etc.
 */

import type { BrowserCookie, FetchJsonOptions, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { generateSnapshotJs, getFormStateJs } from './dom-snapshot.js';
import {
  pressKeyJs,
  waitForTextJs,
  waitForCaptureJs,
  waitForSelectorJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
import {
  resolveTargetJs,
  clickResolvedJs,
  typeResolvedJs,
  prepareNativeTypeResolvedJs,
  scrollResolvedJs,
  type ResolveOptions,
  type TargetMatchLevel,
} from './target-resolver.js';
import { TargetError, type TargetErrorCode } from './target-errors.js';
import { CliError } from '../errors.js';
import { formatSnapshot } from '../snapshotFormatter.js';

export interface ResolveSuccess {
  matches_n: number;
  /**
   * Cascading stale-ref tier the resolver traversed. Callers surface this to
   * agents so `stable` / `reidentified` hits are visibly distinct from a
   * clean `exact` match — the page changed, the action still succeeded.
   */
  match_level: TargetMatchLevel;
}

/**
 * Execute `resolveTargetJs` once, throw structured `TargetError` on failure.
 * Single helper so click/typeText/scrollTo share one resolution pathway,
 * which is what the selector-first contract promises agents.
 */
async function runResolve(
  page: { evaluate(js: string): Promise<unknown> },
  ref: string,
  opts: ResolveOptions = {},
): Promise<ResolveSuccess> {
  const resolution = (await page.evaluate(resolveTargetJs(ref, opts))) as
    | { ok: true; matches_n: number; match_level: TargetMatchLevel }
    | { ok: false; code: TargetErrorCode; message: string; hint: string; candidates?: string[]; matches_n?: number };
  if (!resolution.ok) {
    throw new TargetError({
      code: resolution.code,
      message: resolution.message,
      hint: resolution.hint,
      candidates: resolution.candidates,
      matches_n: resolution.matches_n,
    });
  }
  return { matches_n: resolution.matches_n, match_level: resolution.match_level };
}

function previewText(text: string | undefined): string | undefined {
  const preview = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return preview ? `Response preview: ${preview}` : undefined;
}

function parseKeyChord(rawKey: string): { key: string; modifiers: string[] } {
  const parts = rawKey.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length <= 1) return { key: rawKey, modifiers: [] };

  const modifiers: string[] = [];
  for (const token of parts.slice(0, -1)) {
    const normalized = token.toLowerCase();
    if (normalized === 'ctrl' || normalized === 'control') modifiers.push('Ctrl');
    else if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') modifiers.push('Meta');
    else if (normalized === 'option' || normalized === 'alt') modifiers.push('Alt');
    else if (normalized === 'shift') modifiers.push('Shift');
    else return { key: rawKey, modifiers: [] };
  }

  const key = parts.at(-1);
  return key ? { key, modifiers } : { key: rawKey, modifiers: [] };
}

export abstract class BasePage implements IPage {
  protected _lastUrl: string | null = null;
  /** Cached previous snapshot hashes for incremental diff marking */
  private _prevSnapshotHashes: string | null = null;
  private _cdpTargetMarkerSeq = 0;

  // ── Transport-specific methods (must be implemented by subclasses) ──

  abstract goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number; allowBoundNavigation?: boolean }): Promise<void>;
  abstract evaluate(js: string): Promise<unknown>;

  /**
   * Safely evaluate JS with pre-serialized arguments.
   * Each key in `args` becomes a `const` declaration with JSON-serialized value,
   * prepended to the JS code. Prevents injection by design.
   *
   * Usage:
   *   page.evaluateWithArgs(`(async () => { return sym; })()`, { sym: userInput })
   */
  async evaluateWithArgs(js: string, args: Record<string, unknown>): Promise<unknown> {
    const declarations = Object.entries(args)
      .map(([key, value]) => {
        if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key)) {
          throw new Error(`evaluateWithArgs: invalid key "${key}"`);
        }
        return `const ${key} = ${JSON.stringify(value)};`;
      })
      .join('\n');
    return this.evaluate(`${declarations}\n${js}`);
  }

  async fetchJson(url: string, opts: FetchJsonOptions = {}): Promise<unknown> {
    const request = {
      url,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
      body: opts.body,
      hasBody: opts.body !== undefined,
      timeoutMs: opts.timeoutMs ?? 15_000,
    };

    const result = await this.evaluateWithArgs(`
      (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), request.timeoutMs);
        try {
          const headers = { Accept: 'application/json', ...request.headers };
          const init = {
            method: request.method,
            credentials: 'include',
            headers,
            signal: ctrl.signal,
          };
          if (request.hasBody) {
            if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
              headers['Content-Type'] = 'application/json';
            }
            init.body = JSON.stringify(request.body);
          }
          const resp = await fetch(request.url, init);
          const text = await resp.text();
          return {
            ok: resp.ok,
            status: resp.status,
            statusText: resp.statusText,
            url: resp.url,
            contentType: resp.headers.get('content-type') || '',
            text,
          };
        } catch (error) {
          return {
            ok: false,
            status: 0,
            statusText: '',
            url: request.url,
            contentType: '',
            text: '',
            error: error instanceof Error ? error.message : String(error),
          };
        } finally {
          clearTimeout(timer);
        }
      })()
    `, { request }) as {
      ok?: boolean;
      status?: number;
      statusText?: string;
      url?: string;
      contentType?: string;
      text?: string;
      error?: string;
    };

    const targetUrl = result.url || url;
    if (result.error) {
      throw new CliError(
        'FETCH_ERROR',
        `Browser fetch failed for ${targetUrl}: ${result.error}`,
        'Check that the page is reachable and the current browser profile has access.',
      );
    }
    if (!result.ok) {
      throw new CliError(
        'FETCH_ERROR',
        `HTTP ${result.status ?? 0}${result.statusText ? ` ${result.statusText}` : ''} from ${targetUrl}`,
        previewText(result.text),
      );
    }

    const text = result.text ?? '';
    if (!text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      const contentType = result.contentType ? ` (${result.contentType})` : '';
      throw new CliError(
        'FETCH_ERROR',
        `Expected JSON from ${targetUrl}${contentType}`,
        previewText(text),
      );
    }
  }

  abstract getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  abstract screenshot(options?: ScreenshotOptions): Promise<string>;
  abstract tabs(): Promise<unknown[]>;
  abstract selectTab(target: number | string): Promise<void>;

  // ── Shared DOM helper implementations ──

  async click(ref: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    // Phase 1: Resolve target with fingerprint verification
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');

    // Phase 2: Execute click on resolved element
    const result = await this.evaluate(clickResolvedJs({ skipScroll: nativeScrolled })) as
      | string
      | { status: string; x?: number; y?: number; w?: number; h?: number; error?: string }
      | null;

    if (typeof result === 'string' || result == null) return resolved;

    if (result.status === 'clicked') return resolved;

    // JS click failed — try CDP native click if coordinates available
    if (result.x != null && result.y != null) {
      const success = await this.tryNativeClick(result.x, result.y);
      if (success) return resolved;
    }

    throw new Error(`Click failed: ${result.error ?? 'JS click and CDP fallback both failed'}`);
  }

  /** Uses native CDP click support when the concrete page exposes it. */
  protected async tryNativeClick(x: number, y: number): Promise<boolean> {
    const nativeClick = (this as IPage).nativeClick;
    if (typeof nativeClick !== 'function') return false;
    try {
      await nativeClick.call(this, x, y);
      return true;
    } catch {
      return false;
    }
  }

  /** Uses native CDP text insertion when the concrete page exposes it. */
  protected async tryNativeType(text: string): Promise<boolean> {
    const nativeType = (this as IPage).nativeType;
    if (typeof nativeType === 'function') {
      try {
        await nativeType.call(this, text);
        return true;
      } catch {
        // Fall through to the older dedicated insertText primitive if present.
      }
    }

    const insertText = (this as IPage).insertText;
    if (typeof insertText !== 'function') return false;
    try {
      await insertText.call(this, text);
      return true;
    } catch {
      return false;
    }
  }

  /** Uses native CDP key events when the concrete page exposes them. */
  protected async tryNativeKeyPress(key: string, modifiers: string[]): Promise<boolean> {
    const nativeKeyPress = (this as IPage).nativeKeyPress;
    if (typeof nativeKeyPress !== 'function') return false;
    try {
      await nativeKeyPress.call(this, key, modifiers);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Run a DOM-domain CDP command against `window.__resolved`.
   *
   * CDP DOM.focus / DOM.scrollIntoViewIfNeeded need a nodeId, while our
   * resolver stores the live Element in page JS. Bridge the two worlds with a
   * short-lived marker attribute, then query it through CDP.
   */
  protected async tryCdpOnResolvedElement(method: 'DOM.focus' | 'DOM.scrollIntoViewIfNeeded'): Promise<boolean> {
    const cdp = (this as IPage).cdp;
    if (typeof cdp !== 'function') return false;

    const markerAttr = 'data-opencli-cdp-target';
    const markerValue = `${Date.now().toString(36)}-${++this._cdpTargetMarkerSeq}`;
    const selector = `[${markerAttr}="${markerValue}"]`;
    let marked = false;

    try {
      const marker = await this.evaluateWithArgs(`
        (() => {
          const el = window.__resolved;
          if (!el || el.nodeType !== 1 || typeof el.setAttribute !== 'function') {
            return { ok: false };
          }
          el.setAttribute(markerAttr, markerValue);
          return { ok: true };
        })()
      `, { markerAttr, markerValue }) as { ok?: boolean } | null;
      marked = marker?.ok === true;
      if (!marked) return false;

      await cdp.call(this, 'DOM.enable', {}).catch(() => undefined);
      const doc = await cdp.call(this, 'DOM.getDocument', {}) as { root?: { nodeId?: unknown } } | null;
      const rootNodeId = doc?.root?.nodeId;
      if (typeof rootNodeId !== 'number') return false;

      const query = await cdp.call(this, 'DOM.querySelector', {
        nodeId: rootNodeId,
        selector,
      }) as { nodeId?: unknown } | null;
      const nodeId = query?.nodeId;
      if (typeof nodeId !== 'number' || nodeId <= 0) return false;

      await cdp.call(this, method, { nodeId });
      return true;
    } catch {
      return false;
    } finally {
      if (marked) {
        await this.evaluateWithArgs(`
          (() => {
            for (const el of document.querySelectorAll(selector)) {
              el.removeAttribute(markerAttr);
            }
          })()
        `, { selector, markerAttr }).catch(() => undefined);
      }
    }
  }

  async typeText(ref: string, text: string, opts: ResolveOptions = {}): Promise<ResolveSuccess> {
    const resolved = await runResolve(this, ref, opts);
    let typed = false;
    let nativeScrolled = false;
    let nativeFocused = false;

    if (typeof (this as IPage).nativeType === 'function' || typeof (this as IPage).insertText === 'function') {
      try {
        nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
        nativeFocused = await this.tryCdpOnResolvedElement('DOM.focus');
        const preparation = await this.evaluate(prepareNativeTypeResolvedJs({
          skipScroll: nativeScrolled,
          skipFocus: nativeFocused,
        })) as
          | { ok?: boolean; mode?: string; reason?: string }
          | null;
        typed = preparation?.ok === true && await this.tryNativeType(text);
      } catch {
        // Native input is a reliability upgrade, not the only path. Preserve
        // the existing DOM setter fallback if preparation fails.
      }
    }

    if (!typed) {
      await this.evaluate(typeResolvedJs(text));
    }
    return resolved;
  }

  async pressKey(key: string): Promise<void> {
    const parsed = parseKeyChord(key);
    if (!await this.tryNativeKeyPress(parsed.key, parsed.modifiers)) {
      await this.evaluate(pressKeyJs(parsed.key, parsed.modifiers));
    }
  }

  async scrollTo(ref: string, opts: ResolveOptions = {}): Promise<unknown> {
    const resolved = await runResolve(this, ref, opts);
    const nativeScrolled = await this.tryCdpOnResolvedElement('DOM.scrollIntoViewIfNeeded');
    const result = (await this.evaluate(scrollResolvedJs({ skipScroll: nativeScrolled }))) as Record<string, unknown> | null;
    // Fold match_level into the scroll payload so the user-facing envelope
    // carries it the same way click / type do.
    if (result && typeof result === 'object') {
      return { ...result, matches_n: resolved.matches_n, match_level: resolved.match_level };
    }
    return { matches_n: resolved.matches_n, match_level: resolved.match_level };
  }

  async getFormState(): Promise<Record<string, unknown>> {
    return (await this.evaluate(getFormStateJs())) as Record<string, unknown>;
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    await this.evaluate(scrollJs(direction, amount));
  }

  async autoScroll(options?: { times?: number; delayMs?: number }): Promise<void> {
    const times = options?.times ?? 3;
    const delayMs = options?.delayMs ?? 2000;
    await this.evaluate(autoScrollJs(times, delayMs));
  }

  async networkRequests(includeStatic: boolean = false): Promise<unknown[]> {
    const result = await this.evaluate(networkRequestsJs(includeStatic));
    return Array.isArray(result) ? result : [];
  }

  async consoleMessages(_level: string = 'info'): Promise<unknown[]> {
    return [];
  }

  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      if (options >= 1) {
        try {
          const maxMs = options * 1000;
          await this.evaluate(waitForDomStableJs(maxMs, Math.min(500, maxMs)));
          return;
        } catch {
          // Fallback: fixed sleep
        }
      }
      await new Promise(resolve => setTimeout(resolve, options * 1000));
      return;
    }
    if (typeof options.time === 'number') {
      await new Promise(resolve => setTimeout(resolve, options.time! * 1000));
      return;
    }
    if (options.selector) {
      const timeout = (options.timeout ?? 10) * 1000;
      await this.evaluate(waitForSelectorJs(options.selector, timeout));
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      await this.evaluate(waitForTextJs(options.text, timeout));
    }
  }

  async snapshot(opts: SnapshotOptions = {}): Promise<unknown> {
    const snapshotJs = generateSnapshotJs({
      viewportExpand: opts.viewportExpand ?? 2000,
      maxDepth: Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200)),
      interactiveOnly: opts.interactive ?? false,
      maxTextLength: opts.maxTextLength ?? 120,
      includeScrollInfo: true,
      bboxDedup: true,
      previousHashes: this._prevSnapshotHashes,
    });

    try {
      const result = await this.evaluate(snapshotJs);
      // Read back the hashes stored by the snapshot for next diff
      try {
        const hashes = await this.evaluate('window.__opencli_prev_hashes') as string | null;
        this._prevSnapshotHashes = typeof hashes === 'string' ? hashes : null;
      } catch {
        // Non-fatal: diff is best-effort
      }
      return result;
    } catch (err) {
      // Log snapshot failure for debugging, then fallback to basic accessibility tree
      if (process.env.DEBUG_SNAPSHOT) {
        process.stderr.write(`[snapshot] DOM snapshot failed, falling back to accessibility tree: ${(err as Error)?.message?.slice(0, 200)}\n`);
      }
      return this._basicSnapshot(opts);
    }
  }

  async getCurrentUrl(): Promise<string | null> {
    if (this._lastUrl) return this._lastUrl;
    try {
      const current = await this.evaluate('window.location.href');
      if (typeof current === 'string' && current) {
        this._lastUrl = current;
        return current;
      }
    } catch {
      // Best-effort
    }
    return null;
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

  async waitForCapture(timeout: number = 10): Promise<void> {
    const maxMs = timeout * 1000;
    await this.evaluate(waitForCaptureJs(maxMs));
  }

  /** Fallback basic snapshot */
  protected async _basicSnapshot(opts: Pick<SnapshotOptions, 'interactive' | 'compact' | 'maxDepth' | 'raw'> = {}): Promise<unknown> {
    const maxDepth = Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200));
    const code = `
      (async () => {
        function buildTree(node, depth) {
          if (depth > ${maxDepth}) return '';
          const role = node.getAttribute?.('role') || node.tagName?.toLowerCase() || 'generic';
          const name = node.getAttribute?.('aria-label') || node.getAttribute?.('alt') || node.textContent?.trim().slice(0, 80) || '';
          const isInteractive = ['a', 'button', 'input', 'select', 'textarea'].includes(node.tagName?.toLowerCase()) || node.getAttribute?.('tabindex') != null;

          ${opts.interactive ? 'if (!isInteractive && !node.children?.length) return "";' : ''}

          let indent = '  '.repeat(depth);
          let line = indent + role;
          if (name) line += ' "' + name.replace(/"/g, '\\\\\\"') + '"';
          if (node.tagName?.toLowerCase() === 'a' && node.href) line += ' [' + node.href + ']';
          if (node.tagName?.toLowerCase() === 'input') line += ' [' + (node.type || 'text') + ']';

          let result = line + '\\n';
          if (node.children) {
            for (const child of node.children) {
              result += buildTree(child, depth + 1);
            }
          }
          return result;
        }
        return buildTree(document.body, 0);
      })()
    `;
    const raw = await this.evaluate(code);
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }
}
