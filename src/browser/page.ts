/**
 * Page abstraction — implements IPage by sending commands to the daemon.
 *
 * All browser operations are ultimately 'exec' (JS evaluation via CDP)
 * plus a few native Chrome Extension APIs (tabs, cookies, navigate).
 *
 * IMPORTANT: After goto(), we remember the tabId returned by the navigate
 * action and pass it to all subsequent commands. This avoids the issue
 * where resolveTabId() in the extension picks a chrome:// or
 * chrome-extension:// tab that can't be debugged.
 */

import { formatSnapshot } from '../snapshotFormatter.js';
import type { BrowserCookie, IPage, ScreenshotOptions, SnapshotOptions, WaitOptions } from '../types.js';
import { sendCommand } from './daemon-client.js';
import { wrapForEval } from './utils.js';
import { saveBase64ToFile } from '../utils.js';
import { generateSnapshotJs, scrollToRefJs, getFormStateJs } from './dom-snapshot.js';
import { generateStealthJs } from './stealth.js';
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

export function isRetryableSettleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Inspected target navigated or closed')
    || (message.includes('-32000') && message.toLowerCase().includes('target'));
}

/**
 * Page — implements IPage by talking to the daemon via HTTP.
 */
export class Page implements IPage {
  constructor(private readonly workspace: string = 'default') {}

  /** Active tab ID, set after navigate and used in all subsequent commands */
  private _tabId: number | undefined;
  /** Last navigated URL, tracked in-memory to avoid extra round-trips */
  private _lastUrl: string | null = null;

  /** Helper: spread workspace into command params */
  private _wsOpt(): { workspace: string } {
    return { workspace: this.workspace };
  }

  /** Helper: spread workspace + tabId into command params */
  private _cmdOpts(): Record<string, unknown> {
    return {
      workspace: this.workspace,
      ...(this._tabId !== undefined && { tabId: this._tabId }),
    };
  }

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void> {
    const result = await sendCommand('navigate', {
      url,
      ...this._cmdOpts(),
    }) as { tabId?: number };
    // Remember the tabId and URL for subsequent calls
    if (result?.tabId) {
      this._tabId = result.tabId;
    }
    this._lastUrl = url;
    // Inject stealth anti-detection patches (guard flag prevents double-injection).
    try {
      await sendCommand('exec', {
        code: generateStealthJs(),
        ...this._cmdOpts(),
      });
    } catch {
      // Non-fatal: stealth is best-effort
    }
    // Smart settle: use DOM stability detection instead of fixed sleep.
    // settleMs is now a timeout cap (default 1000ms), not a fixed wait.
    if (options?.waitUntil !== 'none') {
      const maxMs = options?.settleMs ?? 1000;
      const settleOpts = {
        code: waitForDomStableJs(maxMs, Math.min(500, maxMs)),
        ...this._cmdOpts(),
      };
      try {
        await sendCommand('exec', settleOpts);
      } catch (err) {
        if (!isRetryableSettleError(err)) throw err;
        // SPA client-side redirects can invalidate the CDP target after
        // chrome.tabs reports 'complete'. Wait briefly for the new document
        // to load, then retry the settle probe once.
        try {
          await new Promise((r) => setTimeout(r, 200));
          await sendCommand('exec', settleOpts);
        } catch (retryErr) {
          if (!isRetryableSettleError(retryErr)) throw retryErr;
          // Retry also failed — give up silently. Settle is best-effort
          // after successful navigation; the next real command will surface
          // any persistent target error immediately.
        }
      }
    }
  }

  async getCurrentUrl(): Promise<string | null> {
    return this._lastUrl;
  }

  /** Close the automation window in the extension */
  async closeWindow(): Promise<void> {
    try {
      await sendCommand('close-window', { ...this._wsOpt() });
    } catch {
      // Window may already be closed or daemon may be down
    }
  }

  async evaluate(js: string): Promise<unknown> {
    const code = wrapForEval(js);
    return sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async getCookies(opts: { domain?: string; url?: string } = {}): Promise<BrowserCookie[]> {
    const result = await sendCommand('cookies', { ...this._wsOpt(), ...opts });
    return Array.isArray(result) ? result : [];
  }

  async snapshot(opts: SnapshotOptions = {}): Promise<unknown> {
    // Primary: use the advanced DOM snapshot engine with multi-layer pruning
    const snapshotJs = generateSnapshotJs({
      viewportExpand: opts.viewportExpand ?? 800,
      maxDepth: Math.max(1, Math.min(Number(opts.maxDepth) || 50, 200)),
      interactiveOnly: opts.interactive ?? false,
      maxTextLength: opts.maxTextLength ?? 120,
      includeScrollInfo: true,
      bboxDedup: true,
    });

    try {
      const result = await sendCommand('exec', { code: snapshotJs, ...this._cmdOpts() });
      // The advanced engine already produces a clean, pruned, LLM-friendly output.
      // Do NOT pass through formatSnapshot — its format is incompatible.
      return result;
    } catch {
      // Fallback: basic DOM snapshot (original implementation)
      return this._basicSnapshot(opts);
    }
  }

  /** Fallback basic snapshot — original buildTree approach */
  private async _basicSnapshot(opts: Pick<SnapshotOptions, 'interactive' | 'compact' | 'maxDepth' | 'raw'> = {}): Promise<unknown> {
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
    const raw = await sendCommand('exec', { code, ...this._cmdOpts() });
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }

  async click(ref: string): Promise<void> {
    const code = clickJs(ref);
    await sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async typeText(ref: string, text: string): Promise<void> {
    const code = typeTextJs(ref, text);
    await sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async pressKey(key: string): Promise<void> {
    const code = pressKeyJs(key);
    await sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async scrollTo(ref: string): Promise<unknown> {
    const code = scrollToRefJs(ref);
    return sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async getFormState(): Promise<Record<string, unknown>> {
    const code = getFormStateJs();
    return (await sendCommand('exec', { code, ...this._cmdOpts() })) as Record<string, unknown>;
  }

  async wait(options: number | WaitOptions): Promise<void> {
    if (typeof options === 'number') {
      if (options >= 1) {
        // For waits >= 1s, use DOM-stable check: return early when the page
        // stops mutating, with the original wait time as the hard cap.
        // This turns e.g. `page.wait(5)` from a fixed 5s sleep into
        // "wait until DOM is stable, max 5s" — often completing in <1s.
        try {
          const maxMs = options * 1000;
          await sendCommand('exec', {
            code: waitForDomStableJs(maxMs, Math.min(500, maxMs)),
            ...this._cmdOpts(),
          });
          return;
        } catch {
          // Fallback: fixed sleep (e.g. if page has no DOM yet)
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
      const code = waitForSelectorJs(options.selector, timeout);
      await sendCommand('exec', { code, ...this._cmdOpts() });
      return;
    }
    if (options.text) {
      const timeout = (options.timeout ?? 30) * 1000;
      const code = waitForTextJs(options.text, timeout);
      await sendCommand('exec', { code, ...this._cmdOpts() });
    }
  }

  async tabs(): Promise<unknown[]> {
    const result = await sendCommand('tabs', { op: 'list', ...this._wsOpt() });
    return Array.isArray(result) ? result : [];
  }

  async closeTab(index?: number): Promise<void> {
    await sendCommand('tabs', { op: 'close', ...this._wsOpt(), ...(index !== undefined ? { index } : {}) });
    // Invalidate cached tabId — the closed tab might have been our active one.
    // We can't know for sure (close-by-index doesn't return tabId), so reset.
    this._tabId = undefined;
  }

  async newTab(): Promise<void> {
    const result = await sendCommand('tabs', { op: 'new', ...this._wsOpt() }) as { tabId?: number };
    if (result?.tabId) this._tabId = result.tabId;
  }

  async selectTab(index: number): Promise<void> {
    const result = await sendCommand('tabs', { op: 'select', index, ...this._wsOpt() }) as { selected?: number };
    if (result?.selected) this._tabId = result.selected;
  }

  async networkRequests(includeStatic: boolean = false): Promise<unknown[]> {
    const code = networkRequestsJs(includeStatic);
    const result = await sendCommand('exec', { code, ...this._cmdOpts() });
    return Array.isArray(result) ? result : [];
  }

  /**
   * Console messages are not available in lightweight daemon mode.
   * Would require CDP Runtime.consoleAPICalled event listener.
   * @returns Always returns empty array.
   */
  async consoleMessages(_level: string = 'info'): Promise<unknown[]> {
    return [];
  }

  /**
   * Capture a screenshot via CDP Page.captureScreenshot.
   * @param options.format - 'png' (default) or 'jpeg'
   * @param options.quality - JPEG quality 0-100
   * @param options.fullPage - capture full scrollable page
   * @param options.path - save to file path (returns base64 if omitted)
   */
  async screenshot(options: ScreenshotOptions = {}): Promise<string> {
    const base64 = await sendCommand('screenshot', {
      ...this._cmdOpts(),
      format: options.format,
      quality: options.quality,
      fullPage: options.fullPage,
    }) as string;

    if (options.path) {
      await saveBase64ToFile(base64, options.path);
    }

    return base64;
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    const code = scrollJs(direction, amount);
    await sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async autoScroll(options: { times?: number; delayMs?: number } = {}): Promise<void> {
    const times = options.times ?? 3;
    const delayMs = options.delayMs ?? 2000;
    const code = autoScrollJs(times, delayMs);
    await sendCommand('exec', { code, ...this._cmdOpts() });
  }

  async installInterceptor(pattern: string): Promise<void> {
    const { generateInterceptorJs } = await import('../interceptor.js');
    // Must use evaluate() so wrapForEval() converts the arrow function into an IIFE;
    // sendCommand('exec') sends the code as-is, and CDP never executes a bare arrow.
    await this.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<unknown[]> {
    const { generateReadInterceptedJs } = await import('../interceptor.js');
    // Same as installInterceptor: must go through evaluate() for IIFE wrapping
    const result = await this.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return Array.isArray(result) ? result : [];
  }

  async waitForCapture(timeout: number = 10): Promise<void> {
    const maxMs = timeout * 1000;
    await sendCommand('exec', {
      code: waitForCaptureJs(maxMs),
      ...this._cmdOpts(),
    });
  }
}

// (End of file)
