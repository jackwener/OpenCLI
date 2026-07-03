/**
 * Browser session manager — auto-spawns daemon and provides IPage.
 */

import type { ChildProcess } from 'node:child_process';
import type { IPage } from '../types.js';
import type { IBrowserFactory } from '../runtime.js';
import { Page } from './page.js';
import { profileRouteParams, resolveProfileSelection } from './profile.js';
import { ensureBrowserBridgeReady } from './daemon-lifecycle.js';

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

  async connect(opts: { timeout?: number; session?: string; idleTimeout?: number; contextId?: string; preferredContextId?: string; windowMode?: 'foreground' | 'background'; surface?: 'browser' | 'adapter'; siteSession?: 'ephemeral' | 'persistent' } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Already connecting');
    if (this._state === 'closing') throw new Error('Session is closing');
    if (this._state === 'closed') throw new Error('Session is closed');

    this._state = 'connecting';

    try {
      // Requirement vs preference: only an explicit contextId pins daemon
      // readiness and command routing to a specific profile. A preferred one
      // (config default) is arbitrated by the daemon against live connections,
      // so a stale default cannot make connect() wait for a dead profile.
      const routing = opts.contextId || opts.preferredContextId
        ? { contextId: opts.contextId, preferredContextId: opts.preferredContextId }
        : profileRouteParams(resolveProfileSelection());
      await this._ensureDaemon(opts.timeout, routing.contextId);
      if (!opts.session?.trim()) throw new Error('Browser session is required');
      this._page = new Page(opts.session.trim(), opts.idleTimeout, routing.contextId, opts.windowMode, opts.surface, opts.siteSession, routing.preferredContextId);
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
    const result = await ensureBrowserBridgeReady({
      timeoutSeconds: timeoutSeconds ?? Math.ceil(DAEMON_SPAWN_TIMEOUT / 1000),
      contextId,
    });
    this._daemonProc = result.spawnedProcess;
  }
}
