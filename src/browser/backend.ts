import type { IBrowserFactory } from '../runtime.js';
import { CDPBridge } from './cdp.js';
import { BrowserBridge } from './mcp.js';

export type BrowserMode = 'auto' | 'extension' | 'cdp';
export type ResolvedBrowserMode = Exclude<BrowserMode, 'auto'>;

export interface BrowserRuntimeOptions {
  mode?: string;
  cdpEndpoint?: string;
  cdpTarget?: string;
}

export interface ResolvedBrowserBackend {
  requestedMode: BrowserMode;
  mode: ResolvedBrowserMode;
  cdpEndpoint?: string;
  cdpTarget?: string;
}

const VALID_BROWSER_MODES = new Set<BrowserMode>(['auto', 'extension', 'cdp']);

export function normalizeBrowserMode(raw?: string): BrowserMode {
  const value = (raw ?? 'auto').trim().toLowerCase();
  if (VALID_BROWSER_MODES.has(value as BrowserMode)) return value as BrowserMode;
  throw new Error(`Unsupported browser mode: ${raw}. Supported: auto, extension, cdp`);
}

export function applyBrowserRuntimeOptions(opts: BrowserRuntimeOptions = {}): void {
  if (opts.mode !== undefined) process.env.OPENCLI_BROWSER_MODE = normalizeBrowserMode(opts.mode);
  if (opts.cdpEndpoint !== undefined) process.env.OPENCLI_CDP_ENDPOINT = opts.cdpEndpoint;
  if (opts.cdpTarget !== undefined) process.env.OPENCLI_CDP_TARGET = opts.cdpTarget;
}

export function resolveBrowserBackend(rawMode?: string): ResolvedBrowserBackend {
  const requestedMode = normalizeBrowserMode(rawMode ?? process.env.OPENCLI_BROWSER_MODE);
  const cdpEndpoint = process.env.OPENCLI_CDP_ENDPOINT?.trim() || undefined;
  const cdpTarget = process.env.OPENCLI_CDP_TARGET?.trim() || undefined;
  const mode: ResolvedBrowserMode = requestedMode === 'auto'
    ? (cdpEndpoint ? 'cdp' : 'extension')
    : requestedMode;

  return { requestedMode, mode, cdpEndpoint, cdpTarget };
}

export function getBrowserFactory(rawMode?: string): new () => IBrowserFactory {
  const resolved = resolveBrowserBackend(rawMode);
  if (resolved.mode === 'cdp' && !resolved.cdpEndpoint) {
    throw new Error(
      'CDP mode requires a reachable endpoint. Set OPENCLI_CDP_ENDPOINT or pass --cdp-endpoint.\n' +
      'You can start one with: opencli browser launch --port 9222',
    );
  }
  return resolved.mode === 'cdp'
    ? CDPBridge as unknown as new () => IBrowserFactory
    : BrowserBridge as unknown as new () => IBrowserFactory;
}
