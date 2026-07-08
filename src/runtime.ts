import { BrowserBridge, CDPBridge } from './browser/index.js';
import type { IPage } from './types.js';
import { TimeoutError } from './errors.js';
import { isElectronApp } from './electron-apps.js';
import { DEFAULT_BROWSER_COMMAND_TIMEOUT, DEFAULT_BROWSER_CONNECT_TIMEOUT } from './browser/config.js';

export { DEFAULT_BROWSER_COMMAND_TIMEOUT, DEFAULT_BROWSER_CONNECT_TIMEOUT };

/**
 * Returns the appropriate browser factory based on site type.
 * Uses CDPBridge for registered Electron apps, otherwise BrowserBridge.
 */
export function getBrowserFactory(site?: string): new () => IBrowserFactory {
  if (site && isElectronApp(site)) return CDPBridge;
  return BrowserBridge;
}

export type BrowserWindowMode = 'foreground' | 'background';
export type BrowserSurface = 'browser' | 'adapter';

/**
 * Timeout with seconds unit. Used for high-level command timeouts.
 */
export async function runWithTimeout<T>(
  promise: Promise<T>,
  opts: { timeout: number; label?: string; hint?: string },
): Promise<T> {
  const label = opts.label ?? 'Operation';
  return withTimeoutMs(promise, opts.timeout * 1000,
    () => new TimeoutError(label, opts.timeout, opts.hint));
}

/**
 * Timeout with milliseconds unit. Used for low-level internal timeouts.
 * Accepts a factory function to create the rejection error, keeping this
 * utility decoupled from specific error types.
 */
export function withTimeoutMs<T>(
  promise: Promise<T>,
  timeoutMs: number,
  makeError: string | (() => Error) = 'Operation timed out',
): Promise<T> {
  const reject_ = typeof makeError === 'string'
    ? () => new Error(makeError)
    : makeError;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(reject_()), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Interface for browser factory (BrowserBridge or test mocks) */
export interface IBrowserFactory {
  connect(opts?: { timeout?: number; session?: string; cdpEndpoint?: string; contextId?: string; preferredContextId?: string; idleTimeout?: number; windowMode?: BrowserWindowMode; surface?: BrowserSurface; siteSession?: 'ephemeral' | 'persistent' }): Promise<IPage>;
  close(): Promise<void>;
}

export async function browserSession<T>(
  BrowserFactory: new () => IBrowserFactory,
  fn: (page: IPage) => Promise<T>,
  opts: { session?: string; cdpEndpoint?: string; contextId?: string; preferredContextId?: string; idleTimeout?: number; windowMode?: BrowserWindowMode; surface?: BrowserSurface; siteSession?: 'ephemeral' | 'persistent' } = {},
): Promise<T> {
  const browser = new BrowserFactory();
  try {
    const page = await browser.connect({
      timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT,
      session: opts.session,
      cdpEndpoint: opts.cdpEndpoint,
      contextId: opts.contextId,
      preferredContextId: opts.preferredContextId,
      idleTimeout: opts.idleTimeout,
      windowMode: opts.windowMode,
      surface: opts.surface,
      siteSession: opts.siteSession,
    });
    return await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}
