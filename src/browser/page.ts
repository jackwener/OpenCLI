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

import type { BrowserCookie, ScreenshotOptions } from '../types.js';
import { sendCommand } from './daemon-client.js';
import { wrapForEval } from './utils.js';
import { saveBase64ToFile } from '../utils.js';
import { generateStealthJs } from './stealth.js';

import { waitForDomStableJs, waitForCaptureJs, waitForStreamCaptureJs } from './dom-helpers.js';
import { BasePage } from './base-page.js';
export function isRetryableSettleError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Inspected target navigated or closed')
    || (message.includes('-32000') && message.toLowerCase().includes('target'));
}

/**
 * Page — implements IPage by talking to the daemon via HTTP.
 */
export class Page extends BasePage {
  constructor(private readonly workspace: string = 'default') {
    super();
  }

  /** Active tab ID, set after navigate and used in all subsequent commands */
  private _tabId: number | undefined;

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

  getActiveTabId(): number | undefined {
    return this._tabId;
  }

  async evaluate(js: string): Promise<unknown> {
    const code = wrapForEval(js);
    try {
      return await sendCommand('exec', { code, ...this._cmdOpts() });
    } catch (err) {
      if (!isRetryableSettleError(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 200));
      return sendCommand('exec', { code, ...this._cmdOpts() });
    }
  }

  async getCookies(opts: { domain?: string; url?: string } = {}): Promise<BrowserCookie[]> {
    const result = await sendCommand('cookies', { ...this._wsOpt(), ...opts });
    return Array.isArray(result) ? result : [];
  }

  /** Close the automation window in the extension */
  async closeWindow(): Promise<void> {
    try {
      await sendCommand('close-window', { ...this._wsOpt() });
    } catch {
      // Window may already be closed or daemon may be down
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

  /**
   * Capture a screenshot via CDP Page.captureScreenshot.
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

  /**
   * Set local file paths on a file input element via CDP DOM.setFileInputFiles.
   * Chrome reads the files directly from the local filesystem, avoiding the
   * payload size limits of base64-in-evaluate.
   */
  async setFileInput(files: string[], selector?: string): Promise<void> {
    const result = await sendCommand('set-file-input', {
      files,
      selector,
      ...this._cmdOpts(),
    }) as { count?: number };
    if (!result?.count) {
      throw new Error('setFileInput returned no count — command may not be supported by the extension');
    }
  }

  // Override: waitForStreamCapture needs longer HTTP timeout for long-running browser promises
  async waitForStreamCapture(timeout: number = 30, opts?: { minChars?: number; waitForDone?: boolean }): Promise<void> {
    const maxMs = timeout * 1000;
    await sendCommand('exec', {
      code: waitForStreamCaptureJs(maxMs, opts),
      ...this._cmdOpts(),
    }, maxMs + 10000); // HTTP timeout = browser timeout + 10s buffer
  }
}

// (End of file)
