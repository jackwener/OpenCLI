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

import type { BrowserCookie, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';
import {
  clickJs,
  typeTextJs,
  pressKeyJs,
  waitForTextJs,
  waitForCaptureJs,
  waitForSelectorJs,
  scrollJs,
  autoScrollJs,
  networkRequestsJs,
  waitForDomStableJs,
} from './dom-helpers.js';
import { formatSnapshot } from '../snapshotFormatter.js';

export abstract class BasePage implements IPage {
  protected _lastUrl: string | null = null;
  /** Cached previous snapshot hashes for incremental diff marking */
  private _prevSnapshotHashes: string | null = null;

  // ── Transport-specific methods (must be implemented by subclasses) ──

  abstract goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void>;
  abstract evaluate(js: string): Promise<unknown>;
  abstract getCookies(opts?: { domain?: string; url?: string }): Promise<BrowserCookie[]>;
  abstract screenshot(options?: ScreenshotOptions): Promise<string>;
  abstract tabs(): Promise<unknown[]>;
  abstract selectTab(index: number): Promise<void>;

  // ── Shared DOM helper implementations ──

  async click(ref: string): Promise<void> {
    const result = await this.evaluate(clickJs(ref)) as
      | string
      | { status: string; x?: number; y?: number; w?: number; h?: number; error?: string }
      | null;

    // Backwards compat: old format returned 'clicked' string
    if (typeof result === 'string' || result == null) return;

    // JS click succeeded
    if (result.status === 'clicked') return;

    // JS click failed — try CDP native click if coordinates available
    if (result.x != null && result.y != null) {
      const success = await this.tryNativeClick(result.x, result.y);
      if (success) return;
    }

    throw new Error(`Click failed: ${result.error ?? 'JS click and CDP fallback both failed'}`);
  }

  /** Override in subclasses with CDP native click support */
  protected async tryNativeClick(_x: number, _y: number): Promise<boolean> {
    return false;
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
      viewportExpand: opts.viewportExpand ?? 800,
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
    } catch {
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
