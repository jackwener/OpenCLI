/**
 * Browser session manager — auto-spawns daemon and provides IPage.
 *
 * Replaces the old PlaywrightMCP class. Still exports as PlaywrightMCP
 * for backward compatibility with main.ts and other consumers.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { IPage } from '../types.js';
import { Page } from './page.js';
import { isDaemonRunning, isExtensionConnected } from './daemon-client.js';

const DAEMON_SPAWN_TIMEOUT = 10000; // 10s to wait for daemon + extension

export type PlaywrightMCPState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';



/**
 * Browser factory: manages daemon lifecycle and provides IPage instances.
 *
 * Kept as `PlaywrightMCP` class name for backward compatibility.
 */
export class PlaywrightMCP {
  private _state: PlaywrightMCPState = 'idle';
  private _page: Page | null = null;
  private _daemonProc: ChildProcess | null = null;

  get state(): PlaywrightMCPState {
    return this._state;
  }

  async connect(opts: { timeout?: number } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Already connecting');
    if (this._state === 'closing') throw new Error('Session is closing');
    if (this._state === 'closed') throw new Error('Session is closed');

    this._state = 'connecting';

    try {
      await this._ensureDaemon();
      this._page = new Page();
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

  private async _ensureDaemon(): Promise<void> {
    if (await isDaemonRunning()) return;

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

    // Use the current runtime to spawn daemon — avoids slow npx resolution.
    // If already running under tsx (dev), process.execPath is tsx's node.
    // If running compiled (node dist/), process.execPath is node.
    this._daemonProc = spawn(process.execPath, [daemonPath], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    this._daemonProc.unref();

    // Wait for daemon to be ready AND extension to connect
    const deadline = Date.now() + DAEMON_SPAWN_TIMEOUT;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
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
      'Make sure port 19825 is available.',
    );
  }
}
