/**
 * Browser session manager — auto-spawns daemon and provides IPage.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { IPage } from '../types.js';
import type { IBrowserFactory } from '../runtime.js';
import { Page } from './page.js';
import { isDaemonRunning, isExtensionConnected } from './daemon-client.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

const DAEMON_SPAWN_TIMEOUT = 10000; // 10s to wait for daemon + extension

export type BrowserBridgeState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';

/**
 * Browser factory: manages daemon lifecycle and provides IPage instances.
 */
export class BrowserBridge implements IBrowserFactory {
  private _state: BrowserBridgeState = 'idle';
  private _page: Page | null = null;
  private _daemonProc: ChildProcess | null = null;

  get state(): BrowserBridgeState {
    return this._state;
  }

  async connect(opts: { timeout?: number; workspace?: string } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Already connecting');
    if (this._state === 'closing') throw new Error('Session is closing');
    if (this._state === 'closed') throw new Error('Session is closed');

    this._state = 'connecting';

    try {
      await this._ensureDaemon(opts.timeout);
      this._page = new Page(opts.workspace);
      this._state = 'connected';
      return this._page;
    } catch (err) {
      this._state = 'idle';
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this._state === 'closed') return;
    this._state = 'closing';
    // We don't kill the daemon — it auto-exits on idle.
    // Just clean up our reference.
    this._page = null;
    this._state = 'closed';
  }

  private async _ensureDaemon(timeoutSeconds?: number): Promise<void> {
    // Use default if not provided, zero, or negative
    const effectiveSeconds = (timeoutSeconds && timeoutSeconds > 0) ? timeoutSeconds : Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000);
    const timeoutMs = effectiveSeconds * 1000;

    if (await isExtensionConnected()) return;
    if (await isDaemonRunning()) {
      throw new Error(
        'Daemon is running but the Browser Extension is not connected.\n' +
        'Please install and enable the opencli Browser Bridge extension in Chrome.',
      );
    }

    // Find daemon relative to this file — works for both:
    //   npx tsx src/main.ts  → src/browser/mcp.ts  → src/daemon.ts
    //   node dist/main.js    → dist/browser/mcp.js → dist/daemon.js
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const parentDir = path.resolve(__dirname, '..');
    const daemonTs = path.join(parentDir, 'daemon.ts');
    const daemonJs = path.join(parentDir, 'daemon.js');
    const isTs = fs.existsSync(daemonTs);
    const daemonPath = isTs ? daemonTs : daemonJs;

    if (process.env.OPENCLI_VERBOSE) {
      console.error(`[opencli] Starting daemon (${isTs ? 'ts' : 'js'})...`);
    }

    // For compiled .js, use the current node binary directly (fast).
    // For .ts dev mode, node can't run .ts files — use tsx via --import.
    const spawnArgs = isTs
      ? [process.execPath, '--import', 'tsx/esm', daemonPath]
      : [process.execPath, daemonPath];

    this._daemonProc = spawn(spawnArgs[0], spawnArgs.slice(1), {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    this._daemonProc.unref();

    // Wait for daemon to be ready AND extension to connect (exponential backoff)
    const backoffs = [50, 100, 200, 400, 800, 1500, 3000];
    const deadline = Date.now() + timeoutMs;
    for (let i = 0; Date.now() < deadline; i++) {
      await new Promise(resolve => setTimeout(resolve, backoffs[Math.min(i, backoffs.length - 1)]));
      if (await isExtensionConnected()) return;
    }

    // Daemon might be up but extension not connected — give a useful error
    if (await isDaemonRunning()) {
      throw new Error(
        'Daemon is running but the Browser Extension is not connected.\n' +
        'Please install and enable the opencli Browser Bridge extension in Chrome.',
      );
    }

    throw new Error(
      'Failed to start opencli daemon. Try running manually:\n' +
      `  node ${daemonPath}\n` +
      `Make sure port ${DEFAULT_DAEMON_PORT} is available.`,
    );
  }
}
