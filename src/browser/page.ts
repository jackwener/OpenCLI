/**
 * Page abstraction — implements IPage by sending commands to the daemon.
 *
 * All browser operations are ultimately 'exec' (JS evaluation via CDP)
 * plus a few native Chrome Extension APIs (tabs, cookies, navigate).
 *
 * IMPORTANT: After goto(), we remember the page identity (targetId) returned
 * by the navigate action and pass it to all subsequent commands. This ensures
 * page-scoped operations target the correct page without guessing.
 */

import type { BrowserCookie, ScreenshotOptions } from '../types.js';
import { sendCommand, sendCommandFull } from './daemon-client.js';
import { wrapForEval } from './utils.js';
import { saveBase64ToFile } from '../utils.js';
import { generateStealthJs } from './stealth.js';
import { waitForDomStableJs } from './dom-helpers.js';
import { BasePage } from './base-page.js';
import { classifyBrowserError } from './errors.js';
import { log } from '../logger.js';

function isUnsupportedNetworkCaptureError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const normalized = message.toLowerCase();
  return (normalized.includes('unknown action') && normalized.includes('network-capture'))
    || (normalized.includes('network capture') && normalized.includes('not supported'));
}

/**
 * Page — implements IPage by talking to the daemon via HTTP.
 */
export class Page extends BasePage {
  constructor(private readonly workspace: string = 'default') {
    super();
  }

  /** Active page identity (targetId), set after navigate and used in all subsequent commands */
  private _page: string | undefined;
  private _networkCaptureUnsupported = false;
  private _networkCaptureWarned = false;

  /** Helper: spread workspace into command params */
  private _wsOpt(): { workspace: string } {
    return { workspace: this.workspace };
  }

  /** Helper: spread workspace + page identity into command params */
  private _cmdOpts(): Record<string, unknown> {
    return {
      workspace: this.workspace,
      ...(this._page !== undefined && { page: this._page }),
    };
  }

  async goto(url: string, options?: { waitUntil?: 'load' | 'none'; settleMs?: number }): Promise<void> {
    const result = await sendCommandFull('navigate', {
      url,
      ...this._cmdOpts(),
    });
    // Remember the page identity (targetId) for subsequent calls
    if (result.page) {
      this._page = result.page;
    }
    this._lastUrl = url;
    // Inject stealth + settle in a single round-trip instead of two sequential exec calls.
    // The stealth guard flag prevents double-injection; settle uses DOM stability detection.
    if (options?.waitUntil !== 'none') {
      const maxMs = options?.settleMs ?? 1000;
      const combinedCode = `${generateStealthJs()};\n${waitForDomStableJs(maxMs, Math.min(500, maxMs))}`;
      const combinedOpts = {
        code: combinedCode,
        ...this._cmdOpts(),
      };
      try {
        await sendCommand('exec', combinedOpts);
      } catch (err) {
        const advice = classifyBrowserError(err);
        // Only settle-retry on target navigation (SPA client-side redirects).
        // Extension/daemon errors are already retried by sendCommandRaw —
        // retrying them here would silently swallow real failures.
        if (advice.kind !== 'target-navigation') throw err;
        try {
          await new Promise((r) => setTimeout(r, advice.delayMs));
          await sendCommand('exec', combinedOpts);
        } catch (retryErr) {
          if (classifyBrowserError(retryErr).kind !== 'target-navigation') throw retryErr;
        }
      }
    } else {
      // Even with waitUntil='none', still inject stealth (best-effort)
      try {
        await sendCommand('exec', {
          code: generateStealthJs(),
          ...this._cmdOpts(),
        });
      } catch {
        // Non-fatal: stealth is best-effort
      }
    }
  }

  /** Get the active page identity (targetId) */
  getActivePage(): string | undefined {
    return this._page;
  }

  private _markUnsupportedNetworkCapture(): void {
    this._networkCaptureUnsupported = true;
    if (this._networkCaptureWarned) return;
    this._networkCaptureWarned = true;
    log.warn(
      'Browser Bridge extension does not support network capture; continuing without it. ' +
      'Explore output may miss API endpoints until you reload or reinstall the extension.',
    );
  }

  async evaluate(js: string): Promise<unknown> {
    const code = wrapForEval(js);
    try {
      return await sendCommand('exec', { code, ...this._cmdOpts() });
    } catch (err) {
      const advice = classifyBrowserError(err);
      if (advice.kind !== 'target-navigation') throw err;
      await new Promise((resolve) => setTimeout(resolve, advice.delayMs));
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
    } finally {
      this._page = undefined;
      this._lastUrl = null;
      this._networkCaptureUnsupported = false;
      this._networkCaptureWarned = false;
    }
  }

  async tabs(): Promise<unknown[]> {
    const result = await sendCommand('tabs', { op: 'list', ...this._wsOpt() });
    return Array.isArray(result) ? result : [];
  }

  async selectTab(index: number): Promise<void> {
    const result = await sendCommandFull('tabs', { op: 'select', index, ...this._wsOpt() });
    if (result.page) this._page = result.page;
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

  async startNetworkCapture(pattern: string = ''): Promise<boolean> {
    if (this._networkCaptureUnsupported) return false;
    try {
      await sendCommand('network-capture-start', {
        pattern,
        ...this._cmdOpts(),
      });
      return true;
    } catch (err) {
      if (!isUnsupportedNetworkCaptureError(err)) throw err;
      this._markUnsupportedNetworkCapture();
      return false;
    }
  }

  async readNetworkCapture(): Promise<unknown[]> {
    if (this._networkCaptureUnsupported) return [];
    try {
      const result = await sendCommand('network-capture-read', {
        ...this._cmdOpts(),
      });
      return Array.isArray(result) ? result : [];
    } catch (err) {
      if (!isUnsupportedNetworkCaptureError(err)) throw err;
      this._markUnsupportedNetworkCapture();
      return [];
    }
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

  async insertText(text: string): Promise<void> {
    const result = await sendCommand('insert-text', {
      text,
      ...this._cmdOpts(),
    }) as { inserted?: boolean };
    if (!result?.inserted) {
      throw new Error('insertText returned no inserted flag — command may not be supported by the extension');
    }
  }

  async cdp(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return sendCommand('cdp', {
      cdpMethod: method,
      cdpParams: params,
      ...this._cmdOpts(),
    });
  }

  /** CDP native click fallback — called when JS el.click() fails */
  protected override async tryNativeClick(x: number, y: number): Promise<boolean> {
    try {
      await this.nativeClick(x, y);
      return true;
    } catch {
      return false;
    }
  }

  /** Precise click using DOM.getContentQuads/getBoxModel for inline elements */
  async clickWithQuads(ref: string): Promise<void> {
    const safeRef = JSON.stringify(ref);
    const cssSelector = `[data-opencli-ref="${ref.replace(/"/g, '\\"')}"]`;

    // Scroll element into view first
    await this.evaluate(`
      (() => {
        const el = document.querySelector('[data-opencli-ref="' + ${safeRef} + '"]');
        if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
        return !!el;
      })()
    `);

    try {
      // Find DOM node via CDP
      const doc = await this.cdp('DOM.getDocument', {}) as { root: { nodeId: number } };
      const result = await this.cdp('DOM.querySelectorAll', {
        nodeId: doc.root.nodeId,
        selector: cssSelector,
      }) as { nodeIds: number[] };

      if (!result.nodeIds?.length) throw new Error('DOM node not found');

      const nodeId = result.nodeIds[0];

      // Try getContentQuads first (precise for inline elements)
      try {
        const quads = await this.cdp('DOM.getContentQuads', { nodeId }) as { quads: number[][] };
        if (quads.quads?.length) {
          const q = quads.quads[0];
          const cx = (q[0] + q[2] + q[4] + q[6]) / 4;
          const cy = (q[1] + q[3] + q[5] + q[7]) / 4;
          await this.nativeClick(Math.round(cx), Math.round(cy));
          return;
        }
      } catch { /* fallthrough */ }

      // Try getBoxModel
      try {
        const box = await this.cdp('DOM.getBoxModel', { nodeId }) as { model: { content: number[] } };
        if (box.model?.content) {
          const c = box.model.content;
          const cx = (c[0] + c[2] + c[4] + c[6]) / 4;
          const cy = (c[1] + c[3] + c[5] + c[7]) / 4;
          await this.nativeClick(Math.round(cx), Math.round(cy));
          return;
        }
      } catch { /* fallthrough */ }
    } catch { /* fallthrough */ }

    // Final fallback: regular click
    await this.evaluate(`
      (() => {
        const el = document.querySelector('[data-opencli-ref="' + ${safeRef} + '"]');
        if (!el) throw new Error('Element not found: ' + ${safeRef});
        el.click();
        return 'clicked';
      })()
    `);
  }

  async nativeClick(x: number, y: number): Promise<void> {
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x, y,
      button: 'left',
      clickCount: 1,
    });
    await this.cdp('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x, y,
      button: 'left',
      clickCount: 1,
    });
  }

  async nativeType(text: string): Promise<void> {
    // Use Input.insertText for reliable Unicode/CJK text insertion
    await this.cdp('Input.insertText', { text });
  }

  async nativeKeyPress(key: string, modifiers: string[] = []): Promise<void> {
    let modifierFlags = 0;
    for (const mod of modifiers) {
      if (mod === 'Alt') modifierFlags |= 1;
      if (mod === 'Ctrl') modifierFlags |= 2;
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
