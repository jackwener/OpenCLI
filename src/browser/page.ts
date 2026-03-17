/**
 * Page abstraction wrapping JSON-RPC calls to Playwright MCP.
 */

import { formatSnapshot } from '../snapshotFormatter.js';
import { normalizeEvaluateSource } from '../pipeline/template.js';
import { generateInterceptorJs, generateReadInterceptedJs } from '../interceptor.js';
import type { IPage } from '../types.js';
import { BrowserConnectError } from '../errors.js';

/**
 * Page abstraction wrapping JSON-RPC calls to Playwright MCP.
 */
export class Page implements IPage {
  constructor(private _request: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>) {}

  async call(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const resp = await this._request(method, params);
    if (resp.error) throw new Error(`page.${method}: ${(resp.error as any).message ?? JSON.stringify(resp.error)}`);
    // Extract text content from MCP result
    const result = resp.result as any;

    if (result?.isError) {
      const errorText = result.content?.find((c: any) => c.type === 'text')?.text || 'Unknown MCP Error';
      throw new BrowserConnectError(
        errorText,
        'Please check if the browser is running or if the Playwright MCP / CDP connection is configured correctly.'
      );
    }

    if (result?.content) {
      const textParts = result.content.filter((c: any) => c.type === 'text');
      if (textParts.length >= 1) {
        let text = textParts[textParts.length - 1].text; // Usually the main output is in the last text block

        // Some versions of the MCP return error text without the `isError` boolean flag
        if (typeof text === 'string' && text.trim().startsWith('### Error')) {
            throw new BrowserConnectError(
              text.trim(),
              'Please check if the browser is running or if the Playwright MCP / CDP connection is configured correctly.'
            );
        }

        // MCP browser_evaluate returns: "[JSON]\n### Ran Playwright code\n```js\n...\n```"
        // Strip the "### Ran Playwright code" suffix to get clean JSON
        const codeMarker = text.indexOf('### Ran Playwright code');
        if (codeMarker !== -1) {
          text = text.slice(0, codeMarker).trim();
        }
        // Also handle "### Result\n[JSON]" format (some MCP versions)
        const resultMarker = text.indexOf('### Result\n');
        if (resultMarker !== -1) {
          text = text.slice(resultMarker + '### Result\n'.length).trim();
        }
        try { return JSON.parse(text); } catch { return text; }
      }
    }
    return result;
  }

  // --- High-level methods ---

  async goto(url: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_navigate', arguments: { url } });
  }

  async evaluate(js: string): Promise<any> {
    // Normalize IIFE format to function format expected by MCP browser_evaluate
    const normalized = normalizeEvaluateSource(js);
    return this.call('tools/call', { name: 'browser_evaluate', arguments: { function: normalized } });
  }

  async snapshot(opts: { interactive?: boolean; compact?: boolean; maxDepth?: number; raw?: boolean } = {}): Promise<any> {
    const raw = await this.call('tools/call', { name: 'browser_snapshot', arguments: {} });
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }

  async click(ref: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_click', arguments: { element: 'click target', ref } });
  }

  async typeText(ref: string, text: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_type', arguments: { element: 'type target', ref, text } });
  }

  async pressKey(key: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_press_key', arguments: { key } });
  }

  async wait(options: number | { text?: string; time?: number; timeout?: number }): Promise<void> {
    if (typeof options === 'number') {
      await this.call('tools/call', { name: 'browser_wait_for', arguments: { time: options } });
    } else {
      // Pass directly to native wait_for, which supports natively awaiting text strings without heavy DOM polling
      await this.call('tools/call', { name: 'browser_wait_for', arguments: options });
    }
  }

  async tabs(): Promise<any> {
    return this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'list' } });
  }

  async closeTab(index?: number): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'close', ...(index !== undefined ? { index } : {}) } });
  }

  async newTab(): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'new' } });
  }

  async selectTab(index: number): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'select', index } });
  }

  async networkRequests(includeStatic: boolean = false): Promise<any> {
    return this.call('tools/call', { name: 'browser_network_requests', arguments: { includeStatic } });
  }

  async consoleMessages(level: string = 'info'): Promise<any> {
    return this.call('tools/call', { name: 'browser_console_messages', arguments: { level } });
  }

  async scroll(direction: string = 'down', _amount: number = 500): Promise<void> {
    await this.call('tools/call', { name: 'browser_press_key', arguments: { key: direction === 'down' ? 'PageDown' : 'PageUp' } });
  }

  async autoScroll(options: { times?: number; delayMs?: number } = {}): Promise<void> {
    const times = options.times ?? 3;
    const delayMs = options.delayMs ?? 2000;
    const js = `
      async () => {
        const maxTimes = ${times};
        const maxWaitMs = ${delayMs};
        for (let i = 0; i < maxTimes; i++) {
          const lastHeight = document.body.scrollHeight;
          window.scrollTo(0, lastHeight);
          await new Promise(resolve => {
            let timeoutId;
            const observer = new MutationObserver(() => {
              if (document.body.scrollHeight > lastHeight) {
                clearTimeout(timeoutId);
                observer.disconnect();
                setTimeout(resolve, 100); // Small debounce for rendering
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            timeoutId = setTimeout(() => {
              observer.disconnect();
              resolve(null);
            }, maxWaitMs);
          });
        }
      }
    `;
    await this.evaluate(js);
  }

  async installInterceptor(pattern: string): Promise<void> {
    await this.evaluate(generateInterceptorJs(JSON.stringify(pattern), {
      arrayName: '__opencli_xhr',
      patchGuard: '__opencli_interceptor_patched',
    }));
  }

  async getInterceptedRequests(): Promise<any[]> {
    const result = await this.evaluate(generateReadInterceptedJs('__opencli_xhr'));
    return result || [];
  }

  /**
   * Save the current browser session (cookies + localStorage) to a file.
   * Requires the 'storage' capability to be enabled (--caps storage).
   * Used by `opencli login` to persist cookies for headless mode.
   */
  async saveStorageState(filename: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_storage_state', arguments: { filename } });
  }
}
