import { BrowserBridge, CDPBridge } from './browser/index.js';
import type { IPage } from './types.js';
import { TimeoutError } from './errors.js';

/**
 * Returns the appropriate browser factory based on environment config.
 * Uses CDPBridge when OPENCLI_CDP_ENDPOINT is set, otherwise BrowserBridge.
 */
export function getBrowserFactory(): new () => IBrowserFactory {
  return process.env.OPENCLI_CDP_ENDPOINT ? CDPBridge : BrowserBridge;
}

function parseEnvTimeout(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.error(`[runtime] Invalid ${envVar}="${raw}", using default ${fallback}s`);
    return fallback;
  }
  return parsed;
}

export const DEFAULT_BROWSER_CONNECT_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_CONNECT_TIMEOUT', 30);
export const DEFAULT_BROWSER_COMMAND_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_COMMAND_TIMEOUT', 60);
export const DEFAULT_BROWSER_EXPLORE_TIMEOUT = parseEnvTimeout('OPENCLI_BROWSER_EXPLORE_TIMEOUT', 120);

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
