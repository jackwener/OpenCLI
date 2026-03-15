/**
 * Runtime utilities: timeouts and browser session management.
 */

import type { IPage } from './types.js';

export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_CONNECT_TIMEOUT ?? '30', 10);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_COMMAND_TIMEOUT ?? '45', 10);
export const DEFAULT_BROWSER_EXPLORE_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_EXPLORE_TIMEOUT ?? '120', 10);
export const DEFAULT_BROWSER_SMOKE_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_SMOKE_TIMEOUT ?? '60', 10);

export async function runWithTimeout<T>(
  promise: Promise<T>,
  opts: { timeout: number; label?: string },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${opts.label ?? 'Operation'} timed out after ${opts.timeout}s`));
    }, opts.timeout * 1000);

    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

export async function browserSession<T>(
  BrowserFactory: new () => any,
  fn: (page: IPage) => Promise<T>,
): Promise<T> {
  const mcp = new BrowserFactory();
  try {
    const page = await mcp.connect({ timeout: DEFAULT_BROWSER_CONNECT_TIMEOUT });
    return await fn(page);
  } finally {
    await mcp.close().catch(() => {});
  }
}
