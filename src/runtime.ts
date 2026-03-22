import { BrowserBridge, CDPBridge } from './browser/index.js';
import { CamoufoxBridge } from './browser/camoufox-bridge.js';
import type { IPage } from './types.js';

/**
 * Returns the appropriate browser factory based on environment config.
 * Uses CDPBridge when OPENCLI_CDP_ENDPOINT is set, otherwise BrowserBridge.
 */
export function getBrowserFactory(): new () => IBrowserFactory {
  if (process.env.OPENCLI_CAMOUFOX_WS) return CamoufoxBridge as any;
  return (process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge) as any;
}

export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_CONNECT_TIMEOUT ?? '30', 10);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT ?? '60', 10);
export const DEFAULT_BROWSER_EXPLORE_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_EXPLORE_TIMEOUT ?? '120', 10);
export const DEFAULT_BROWSER_SMOKE_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_SMOKE_TIMEOUT ?? '60', 10);

/**
 * Timeout with seconds unit. Used for high-level command timeouts.
 */
export async function runWithTimeout<T>(
  promise: Promise<T>,
  opts: { timeout: number; label?: string },
): Promise<T> {
  return withTimeoutMs(promise, opts.timeout * 1000, `${opts.label ?? 'Operation'} timed out after ${opts.timeout}s`);
}

/**
 * Timeout with milliseconds unit. Used for low-level internal timeouts.
 */
export function withTimeoutMs<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Interface for browser factory (BrowserBridge or test mocks) */
export interface IBrowserFactory {
  connect(opts?: { timeout?: number; workspace?: string }): Promise<IPage>;
  close(): Promise<void>;
}

export async function browserSession<T>(
  BrowserFactory: new () => IBrowserFactory,
  fn: (page: IPage) => Promise<T>,
  opts: { workspace?: string } = {},
): Promise<T> {
  const mcp = new BrowserFactory();
  try {
    const page = await mcp.connect({ timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT, workspace: opts.workspace });
    return await fn(page);
  } finally {
    await mcp.close().catch(() => {});
  }
}
