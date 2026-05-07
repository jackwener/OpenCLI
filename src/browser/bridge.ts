/**
 * Browser session manager — auto-spawns daemon and provides IPage.
 */

import type { ChildProcess } from 'node:child_process';
import type { IPage } from '../types.js';
import type { IBrowserFactory } from '../runtime.js';
import { Page } from './page.js';
import { getDaemonHealth, requestDaemonShutdown } from './daemon-client.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { BrowserConnectError } from '../errors.js';
import { PKG_VERSION } from '../version.js';
import { resolveProfileContextId } from './profile.js';
import { resolveDaemonLaunchSpec, spawnDaemonProcess, waitForDaemonStop } from './daemon-lifecycle.js';

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

  async connect(opts: { timeout?: number; workspace?: string; idleTimeout?: number; contextId?: string } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Already connecting');
    if (this._state === 'closing') throw new Error('Session is closing');
    if (this._state === 'closed') throw new Error('Session is closed');

    this._state = 'connecting';

    try {
      const contextId = opts.contextId ?? resolveProfileContextId();
      await this._ensureDaemon(opts.timeout, contextId);
      this._page = new Page(opts.workspace, opts.idleTimeout, contextId);
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
    // We don't kill the daemon — it's persistent.
    // Just clean up our reference.
    this._page = null;
    this._state = 'closed';
  }

  private async _ensureDaemon(timeoutSeconds?: number, contextId?: string): Promise<void> {
    const effectiveSeconds = (timeoutSeconds && timeoutSeconds > 0) ? timeoutSeconds : Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000);
    const timeoutMs = effectiveSeconds * 1000;

    const health = await getDaemonHealth({ contextId });

    // Fast path: everything ready
    if (health.state === 'ready') return;

    if (health.state === 'profile-required') {
      throw new BrowserConnectError(
        'Multiple Browser Bridge profiles are connected',
        'Select one with --profile <name>, OPENCLI_PROFILE=<name>, or opencli profile use <name>.\n' +
        'Run opencli profile list to see connected profiles.',
        'profile-required',
      );
    }

    if (health.state === 'profile-disconnected') {
      const label = contextId ?? health.status.contextId ?? 'unknown';
      throw new BrowserConnectError(
        `Browser profile "${label}" is not connected`,
        'Open the matching Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
        'profile-disconnected',
      );
    }

    // Daemon running but no extension
    if (health.state === 'no-extension') {
      // Detect stale daemon: version mismatch OR missing daemonVersion (pre-version daemon)
      const daemonVersion = health.status?.daemonVersion;
      const isStale = !daemonVersion || daemonVersion !== PKG_VERSION;

      if (isStale) {
        // Stale daemon — restart it so extension gets a fresh WebSocket endpoint
        const reason = daemonVersion
          ? `v${daemonVersion} ≠ v${PKG_VERSION}`
          : `pre-version daemon, CLI is v${PKG_VERSION}`;
        if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
          process.stderr.write(`⚠️  Stale daemon detected (${reason}). Restarting...\n`);
        }
        const shutdownAccepted = await requestDaemonShutdown();
        const portReleased = shutdownAccepted && await waitForDaemonStop(3000);

        if (!portReleased) {
          // Stale daemon replacement failed — don't blindly spawn on an occupied port
          throw new BrowserConnectError(
            'Stale daemon could not be replaced',
            `A stale daemon (${reason}) is running but did not shut down.\n` +
            '  Run manually: opencli daemon stop && opencli doctor',
            'daemon-not-running',
          );
        }
        // Port released — fall through to spawn a fresh daemon
      } else {
        // Same version — wait for extension to connect
        if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
          process.stderr.write('⏳ Waiting for Chrome/Chromium extension to connect...\n');
          process.stderr.write('   Make sure Chrome or Chromium is open and the OpenCLI extension is enabled.\n');
        }
        if (await this._pollUntilReady(timeoutMs, contextId)) return;
        const finalHealth = await getDaemonHealth({ contextId });
        if (finalHealth.state === 'profile-required') {
          throw new BrowserConnectError(
            'Multiple Browser Bridge profiles are connected',
            'Select one with --profile <name>, OPENCLI_PROFILE=<name>, or opencli profile use <name>.\n' +
            'Run opencli profile list to see connected profiles.',
            'profile-required',
          );
        }
        if (finalHealth.state === 'profile-disconnected') {
          const label = contextId ?? finalHealth.status.contextId ?? 'unknown';
          throw new BrowserConnectError(
            `Browser profile "${label}" is not connected`,
            'Open the matching Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
            'profile-disconnected',
          );
        }
        throw new BrowserConnectError(
          'Browser Bridge extension not connected',
          'Make sure Chrome/Chromium is open and the extension is enabled.\n' +
          'Try running the command again — the extension may need a moment to reconnect.\n' +
          'If it still fails, reload OpenCLI in chrome://extensions and run: opencli doctor\n' +
          'If not installed:\n' +
          '  1. Download: https://github.com/jackwener/opencli/releases\n' +
          '  2. Open chrome://extensions → Developer Mode → Load unpacked',
          'extension-not-connected',
        );
      }
    }

    // No daemon — spawn one
    if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
      process.stderr.write('⏳ Starting daemon...\n');
    }

    this._daemonProc = spawnDaemonProcess();

    // Wait for daemon + extension
    if (await this._pollUntilReady(timeoutMs, contextId)) return;

    const finalHealth = await getDaemonHealth({ contextId });
    if (finalHealth.state === 'profile-required') {
      throw new BrowserConnectError(
        'Multiple Browser Bridge profiles are connected',
        'Select one with --profile <name>, OPENCLI_PROFILE=<name>, or opencli profile use <name>.\n' +
        'Run opencli profile list to see connected profiles.',
        'profile-required',
      );
    }
    if (finalHealth.state === 'profile-disconnected') {
      const label = contextId ?? finalHealth.status.contextId ?? 'unknown';
      throw new BrowserConnectError(
        `Browser profile "${label}" is not connected`,
        'Open the matching Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
        'profile-disconnected',
      );
    }
    if (finalHealth.state === 'no-extension') {
      throw new BrowserConnectError(
        'Browser Bridge extension not connected',
        'Make sure Chrome/Chromium is open and the extension is enabled.\n' +
        'Try running the command again — the extension may need a moment to reconnect.\n' +
        'If it still fails, reload OpenCLI in chrome://extensions and run: opencli doctor\n' +
        'If not installed:\n' +
        '  1. Download: https://github.com/jackwener/opencli/releases\n' +
        '  2. Open chrome://extensions → Developer Mode → Load unpacked',
        'extension-not-connected',
      );
    }

    throw new BrowserConnectError(
      'Failed to start opencli daemon',
      `Try running manually:\n  node ${resolveDaemonLaunchSpec().scriptPath}\nMake sure port ${DEFAULT_DAEMON_PORT} is available.`,
      'daemon-not-running',
    );
  }

  /** Poll getDaemonHealth() until state is 'ready' or deadline is reached. */
  private async _pollUntilReady(timeoutMs: number, contextId?: string): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const h = await getDaemonHealth({ contextId });
      if (h.state === 'ready') return true;
    }
    return false;
  }
}
