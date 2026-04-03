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
import { getBrowserCandidates, launchBrowserCandidate } from './candidates.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

const DAEMON_SPAWN_TIMEOUT = 10000; // 10s to wait for daemon + extension
const EXTENSION_POLL_INTERVAL_MS = 200;
const MAX_PER_BROWSER_WAIT_MS = 2000;

export type BrowserBridgeState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';

/**
 * Browser factory: manages daemon lifecycle and provides IPage instances.
 */
export class BrowserBridge implements IBrowserFactory {
  private _state: BrowserBridgeState = 'idle';
  private _page: Page | null = null;
  private _daemonProc: ChildProcess | null = null;
  private _lastDetectedBrowsers: string[] = [];
  private _lastTriedBrowsers: string[] = [];
  private _inferredBrowserName: string | null = null;

  get state(): BrowserBridgeState {
    return this._state;
  }

  get inferredBrowserName(): string | null {
    return this._inferredBrowserName;
  }

  async connect(opts: { timeout?: number; workspace?: string } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Already connecting');
    if (this._state === 'closing') throw new Error('Session is closing');
    if (this._state === 'closed') throw new Error('Session is closed');

    this._state = 'connecting';
    this._inferredBrowserName = null;

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
        process.stderr.write('⏳ Waiting for Browser Bridge extension to connect...\n');
      }
      if (await this._tryLaunchBrowsers(timeoutMs)) return;
      throw new Error(this._buildExtensionError(this._lastDetectedBrowsers, this._lastTriedBrowsers));
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
    if (await this._tryLaunchBrowsers(timeoutMs)) return;

    if ((await fetchDaemonStatus()) !== null) {
      throw new Error(this._buildExtensionError(this._lastDetectedBrowsers, this._lastTriedBrowsers));
    }

    throw new Error(
      'Failed to start opencli daemon. Try running manually:\n' +
      `  node ${daemonPath}\n` +
      `Make sure port ${DEFAULT_DAEMON_PORT} is available.`,
    );
  }

  private async _tryLaunchBrowsers(timeoutMs: number): Promise<boolean> {
    const candidates = getBrowserCandidates();
    this._lastDetectedBrowsers = candidates.map(candidate => candidate.name);
    this._lastTriedBrowsers = [];

    if (await isExtensionConnected()) return true;
    const startedAt = Date.now();
    const runningCandidates = candidates.filter(candidate => candidate.running);
    const stoppedCandidates = candidates.filter(candidate => !candidate.running);
    const perBrowserWaitMs = candidates.length > 0
      ? Math.min(MAX_PER_BROWSER_WAIT_MS, Math.max(EXTENSION_POLL_INTERVAL_MS, Math.floor(timeoutMs / candidates.length)))
      : timeoutMs;

    if (await this._tryCandidateGroup(runningCandidates, { launch: false, timeoutMs, startedAt, perBrowserWaitMs })) return true;
    if (await this._tryCandidateGroup(stoppedCandidates, { launch: true, timeoutMs, startedAt, perBrowserWaitMs })) return true;

    const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
    if (remainingMs > 0 && await this._waitForExtensionConnection(remainingMs)) return true;
    return false;
  }

  private async _tryCandidateGroup(
    candidates: ReturnType<typeof getBrowserCandidates>,
    opts: { launch: boolean; timeoutMs: number; startedAt: number; perBrowserWaitMs: number },
  ): Promise<boolean> {
    if (candidates.length === 0) return false;

    for (const candidate of candidates) {
      const remainingMs = Math.max(0, opts.timeoutMs - (Date.now() - opts.startedAt));
      if (remainingMs <= 0) break;

      this._lastTriedBrowsers.push(candidate.name);
      if (process.env.OPENCLI_VERBOSE || process.stderr.isTTY) {
        process.stderr.write(`   Trying browser: ${candidate.name}\n`);
      }

      if (opts.launch) {
        await launchBrowserCandidate(candidate);
        if (await isExtensionConnected()) {
          this._inferredBrowserName = candidate.name;
          return true;
        }
      }

      if (await this._waitForExtensionConnection(Math.min(opts.perBrowserWaitMs, remainingMs))) {
        this._inferredBrowserName = candidate.name;
        return true;
      }
    }

    return false;
  }

  private async _waitForExtensionConnection(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const sleepMs = Math.min(EXTENSION_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now()));
      if (sleepMs <= 0) break;
      await new Promise(resolve => setTimeout(resolve, sleepMs));
      if (await isExtensionConnected()) return true;
    }
    return false;
  }

  private _buildExtensionError(
    detected: string[],
    tried: string[],
  ): string {
    const detectedText = detected.length > 0 ? detected.join(', ') : 'none';
    const triedText = tried.length > 0 ? tried.join(', ') : 'none';
    return (
      'Daemon is running but the Browser Extension is not connected.\n' +
      `Detected browsers: ${detectedText}\n` +
      `Tried browsers: ${triedText}\n` +
      'Please install and enable the opencli Browser Bridge extension in a Chromium-based browser.\n' +
      '  Chrome: chrome://extensions\n' +
      '  Edge: edge://extensions'
    );
  }
}
