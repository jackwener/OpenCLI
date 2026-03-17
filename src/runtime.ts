/**
 * Runtime utilities: timeouts and browser session management.
 */

import type { IPage } from './types.js';

export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_CONNECT_TIMEOUT ?? '30', 10);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT ?? '45', 10);
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

/** Interface for browser factory (PlaywrightMCP or test mocks) */
export interface IBrowserFactory {
  connect(opts?: { timeout?: number; headless?: boolean; caps?: string[] }): Promise<IPage>;
  close(): Promise<void>;
}

export async function browserSession<T>(
  BrowserFactory: new () => IBrowserFactory,
  fn: (page: IPage) => Promise<T>,
  opts?: { headless?: boolean; caps?: string[] },
): Promise<T> {
  const mcp = new BrowserFactory();
  try {
    const page = await mcp.connect({ timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT, headless: opts?.headless, caps: opts?.caps });
    return await fn(page);
  } finally {
    await mcp.close().catch(() => {});
  }
}
