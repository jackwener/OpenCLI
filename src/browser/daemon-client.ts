/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */

import { DEFAULT_DAEMON_PORT } from '../constants.js';
import type { BrowserSessionInfo } from '../types.js';
import { sleep } from '../utils.js';
import { classifyBrowserError } from './errors.js';

export function getEffectiveDaemonPort(): number {
  return parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
}

const DAEMON_PORT = getEffectiveDaemonPort();
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const OPENCLI_HEADERS = { 'X-OpenCLI': '1' };

let _idCounter = 0;

function generateId(): string {
  return `cmd_${process.pid}_${Date.now()}_${++_idCounter}`;
}

export interface DaemonCommand {
  id: string;
  action: 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'sessions' | 'set-file-input' | 'insert-text' | 'bind-current' | 'network-capture-start' | 'network-capture-read' | 'cdp' | 'frames';
  /** Target page identity (targetId). Cross-layer contract with the extension. */
  page?: string;
  code?: string;
  workspace?: string;
  url?: string;
  op?: string;
  index?: number;
  domain?: string;
  matchDomain?: string;
  matchPathPrefix?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;

  /** Local file paths for set-file-input action */
  files?: string[];
  /** CSS selector for file input element (set-file-input action) */
  selector?: string;
  /** Raw text payload for insert-text action */
  text?: string;
  /** URL substring filter pattern for network capture */
  pattern?: string;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
  /** When true, automation windows are created in the foreground */
  windowFocused?: boolean;
  /** Custom idle timeout in seconds for this workspace session. Overrides the default. */
  idleTimeout?: number;
  /** Frame index for cross-frame operations (0-based, from 'frames' action) */
  frameIndex?: number;
}

export interface DaemonResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  /** Page identity (targetId) — present on page-scoped command responses */
  page?: string;
}

export interface DaemonStatus {
  ok: boolean;
  pid: number;
  uptime: number;
  daemonVersion?: string;
  extensionConnected: boolean;
  extensionVersion?: string;
  extensionCompatRange?: string;
  pending: number;
  memoryMB: number;
  port: number;
}

async function requestDaemon(pathname: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
  const { timeout = 2000, headers, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${DAEMON_URL}${pathname}`, {
      ...rest,
      headers: { ...OPENCLI_HEADERS, ...headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDaemonStatus(opts?: { timeout?: number }): Promise<DaemonStatus | null> {
  try {
    const res = await requestDaemon('/status', { timeout: opts?.timeout ?? 2000 });
    if (!res.ok) return null;
    return await res.json() as DaemonStatus;
  } catch {
    return null;
  }
}

export type DaemonHealth =
  | { state: 'stopped'; status: null }
  | { state: 'no-extension'; status: DaemonStatus }
  | { state: 'ready'; status: DaemonStatus };

/**
 * Unified daemon health check — single entry point for all status queries.
 * Replaces isDaemonRunning(), isExtensionConnected(), and checkDaemonStatus().
 */
export async function getDaemonHealth(opts?: { timeout?: number }): Promise<DaemonHealth> {
  const status = await fetchDaemonStatus(opts);
  if (!status) return { state: 'stopped', status: null };
  if (!status.extensionConnected) return { state: 'no-extension', status };
  return { state: 'ready', status };
}

export async function requestDaemonShutdown(opts?: { timeout?: number }): Promise<boolean> {
  try {
    const res = await requestDaemon('/shutdown', { method: 'POST', timeout: opts?.timeout ?? 5000 });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Internal: send a command to the daemon with retry logic.
 * Returns the raw DaemonResult. All retry policy lives here — callers
 * (sendCommand, sendCommandFull) only shape the return value.
 *
 * Retries up to 4 times:
 * - Network errors (TypeError, AbortError): retry at 500ms
 * - Transient browser errors: retry at the delay suggested by classifyBrowserError()
 */
async function sendCommandRaw(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'>,
): Promise<DaemonResult> {
  const maxRetries = 4;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const id = generateId();
    const wf = process.env.OPENCLI_WINDOW_FOCUSED;
    const windowFocused = (wf === '1' || wf === 'true') ? true : undefined;
    const command: DaemonCommand = { id, action, ...params, ...(windowFocused && { windowFocused }) };
    try {
      const res = await requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        timeout: 30000,
      });

      const result = (await res.json()) as DaemonResult;

      if (!result.ok) {
        const isDuplicateCommandId = res.status === 409
          || (result.error ?? '').includes('Duplicate command id');
        if (isDuplicateCommandId && attempt < maxRetries) {
          continue;
        }
        const advice = classifyBrowserError(new Error(result.error ?? ''));
        if (advice.retryable && attempt < maxRetries) {
          await sleep(advice.delayMs);
          continue;
        }
        throw new Error(result.error ?? 'Daemon command failed');
      }

      return result;
    } catch (err) {
      const isNetworkError = err instanceof TypeError
        || (err instanceof Error && err.name === 'AbortError');
      if (isNetworkError && attempt < maxRetries) {
        await sleep(500);
        continue;
      }
      throw err;
    }
  }
  throw new Error('sendCommand: max retries exhausted');
}

/**
 * Send a command to the daemon and return the result data.
 */
export async function sendCommand(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'> = {},
): Promise<unknown> {
  const result = await sendCommandRaw(action, params);
  return result.data;
}

/**
 * Like sendCommand, but returns both data and page identity (targetId).
 * Use this for page-scoped commands where the caller needs the page identity.
 */
export async function sendCommandFull(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'> = {},
): Promise<{ data: unknown; page?: string }> {
  const result = await sendCommandRaw(action, params);
  return { data: result.data, page: result.page };
}

export async function listSessions(): Promise<BrowserSessionInfo[]> {
  const result = await sendCommand('sessions');
  return Array.isArray(result) ? result : [];
}

export async function bindCurrentTab(workspace: string, opts: { matchDomain?: string; matchPathPrefix?: string } = {}): Promise<unknown> {
  return sendCommand('bind-current', { workspace, ...opts });
}
