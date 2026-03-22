/**
 * CamoufoxBridge — IBrowserFactory that connects to a running Camoufox server
 * via playwright-core's Juggler (Firefox) WebSocket protocol.
 *
 * Usage:
 *   1. Start camoufox server: `python -m camoufox server --port 19826`
 *   2. Set env: OPENCLI_CAMOUFOX_WS=ws://127.0.0.1:19826
 *   3. All opencli commands now run on camoufox instead of Chrome
 */

import { firefox } from 'playwright-core';
import type { Browser, BrowserContext } from 'playwright-core';
import type { IBrowserFactory } from '../runtime.js';
import type { IPage } from '../types.js';
import { CamoufoxPage } from './camoufox-page.js';

const DEFAULT_WS = 'ws://127.0.0.1:19826';

export class CamoufoxBridge implements IBrowserFactory {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;

  async connect(opts?: { timeout?: number; workspace?: string }): Promise<IPage> {
    const wsEndpoint = process.env.OPENCLI_CAMOUFOX_WS ?? DEFAULT_WS;
    const timeoutMs = (opts?.timeout ?? 30) * 1000;

    this.browser = await firefox.connect(wsEndpoint, { timeout: timeoutMs });
    this.context = await this.browser.newContext();
    const page = await this.context.newPage();
    return new CamoufoxPage(page, this.context);
  }

  async close(): Promise<void> {
    try {
      await this.context?.close();
    } catch {
      // Context may already be closed
    }
    this.context = null;
    // Don't close the browser — camoufox server manages its own lifecycle
    this.browser = null;
  }
}
