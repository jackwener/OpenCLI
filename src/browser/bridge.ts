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
import { fetchDaemonStatus, isExtensionConnected } from './daemon-client.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { BrowserConnectError } from '../errors.js';

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
    const effectiveSeconds = (timeoutSeconds && timeoutSeconds > 0) ? timeoutSeconds : Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000);
    const timeoutMs = effectiveSeconds * 1000;

    // Single status check instead of two separate fetchDaemonStatus() calls
    const status = await fetchDaemonStatus();

    // Fast path: extension already connected
    if (status?.extensionConnected) return;

    // Daemon running but no extension — wait for extension with progress
    if (status !== null) {
      if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
        process.stderr.write('⏳ Waiting for Chrome/Chromium extension to connect...\n');
        process.stderr.write('   Make sure Chrome or Chromium is open and the OpenCLI extension is enabled.\n');
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 200));
        if (await isExtensionConnected()) return;
      }
      throw new BrowserConnectError(
        'Browser Bridge extension not connected',
        'Install the Browser Bridge:\n' +
        '  1. Download: https://github.com/jackwener/opencli/releases\n' +
        '  2. In Chrome or Chromium, open chrome://extensions → Developer Mode → Load unpacked\n' +
        '  Then run: opencli doctor',
        'extension-not-connected',
      );
    }

    // No daemon — spawn one
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const parentDir = path.resolve(__dirname, '..');
    const daemonTs = path.join(parentDir, 'daemon.ts');
    const daemonJs = path.join(parentDir, 'daemon.js');
    const isTs = fs.existsSync(daemonTs);
    const daemonPath = isTs ? daemonTs : daemonJs;

    if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
      process.stderr.write('⏳ Starting daemon...\n');
    }

    const spawnArgs = isTs
      ? [process.execPath, '--import', 'tsx/esm', daemonPath]
      : [process.execPath, daemonPath];

    this._daemonProc = spawn(spawnArgs[0], spawnArgs.slice(1), {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    });
    this._daemonProc.unref();

    // Wait for daemon + extension with faster polling
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (await isExtensionConnected()) return;
    }

    if ((await fetchDaemonStatus()) !== null) {
      throw new BrowserConnectError(
        'Browser Bridge extension not connected',
        'Install the Browser Bridge:\n' +
        '  1. Download: https://github.com/jackwener/opencli/releases\n' +
        '  2. In Chrome or Chromium, open chrome://extensions → Developer Mode → Load unpacked\n' +
        '  Then run: opencli doctor',
        'extension-not-connected',
      );
    }

    throw new BrowserConnectError(
      'Failed to start opencli daemon',
      `Try running manually:\n  node ${daemonPath}\nMake sure port ${DEFAULT_DAEMON_PORT} is available.`,
      'daemon-not-running',
    );
  }
}
