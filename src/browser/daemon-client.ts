/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */

import { DEFAULT_DAEMON_PORT } from '../constants.js';
import type { BrowserSessionInfo } from '../types.js';
import { sleep } from '../utils.js';

const DAEMON_PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;

let _idCounter = 0;

function generateId(): string {
  return `cmd_${Date.now()}_${++_idCounter}`;
}

export interface DaemonCommand {
  id: string;
  action: 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'sessions' | 'set-file-input' | 'bind-current';
  tabId?: number;
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
}

export interface DaemonResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Check if daemon is running.
 */
export async function isDaemonRunning(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DAEMON_URL}/status`, {
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Check if daemon is running AND the extension is connected.
 */
export async function isExtensionConnected(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DAEMON_URL}/status`, {
      headers: { 'X-OpenCLI': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json() as { extensionConnected?: boolean };
    return !!data.extensionConnected;
  } catch {
    return false;
  }
}

/**
 * Send a command to the daemon and wait for a result.
 * Retries up to 4 times: network errors retry at 500ms,
 * transient extension errors retry at 1500ms.
 */
export async function sendCommand(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'> = {},
): Promise<unknown> {
  const maxRetries = 4;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // Generate a fresh ID per attempt to avoid daemon-side duplicate detection
    const id = generateId();
    const command: DaemonCommand = { id, action, ...params };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);

      const res = await fetch(`${DAEMON_URL}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-OpenCLI': '1' },
        body: JSON.stringify(command),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const result = (await res.json()) as DaemonResult;

      if (!result.ok) {
        // Check if error is a transient extension issue worth retrying
        const errMsg = result.error ?? '';
        const isTransient = errMsg.includes('Extension disconnected')
          || errMsg.includes('Extension not connected')
          || errMsg.includes('attach failed')
          || errMsg.includes('no longer exists');
        if (isTransient && attempt < maxRetries) {
          // Longer delay for extension recovery (service worker restart)
          await sleep(1500);
          continue;
        }
        throw new Error(result.error ?? 'Daemon command failed');
      }

      return result.data;
    } catch (err) {
      const isRetryable = err instanceof TypeError  // fetch network error
        || (err instanceof Error && err.name === 'AbortError');
      if (isRetryable && attempt < maxRetries) {
        await sleep(500);
        continue;
      }
      throw err;
    }
  }
  // Unreachable — the loop always returns or throws
  throw new Error('sendCommand: max retries exhausted');
}

export async function listSessions(): Promise<BrowserSessionInfo[]> {
  const result = await sendCommand('sessions');
  return Array.isArray(result) ? result : [];
}

export async function bindCurrentTab(workspace: string, opts: { matchDomain?: string; matchPathPrefix?: string } = {}): Promise<unknown> {
  return sendCommand('bind-current', { workspace, ...opts });
}

