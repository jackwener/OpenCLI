/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */

import { sleep } from '../utils.js';
import { BrowserConnectError } from '../errors.js';
import { classifyBrowserError } from './errors.js';
import { resolveProfileContextId } from './profile.js';
import { DEFAULT_BROWSER_CONNECT_TIMEOUT } from './config.js';
import { ensureBrowserBridgeReady } from './daemon-lifecycle.js';
import { isPreDispatchError } from './bridge-readiness.js';
import {
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemon,
  requestDaemonShutdown,
  type BrowserProfileStatus,
  type DaemonHealth,
  type DaemonStatus,
} from './daemon-transport.js';

let _idCounter = 0;

function generateId(): string {
  return `cmd_${process.pid}_${Date.now()}_${++_idCounter}`;
}

export interface DaemonCommand {
  id: string;
  action: 'exec' | 'navigate' | 'tabs' | 'cookies' | 'screenshot' | 'close-window' | 'set-file-input' | 'insert-text' | 'bind' | 'network-capture-start' | 'network-capture-read' | 'wait-download' | 'cdp' | 'frames';
  /** Target page identity (targetId). Cross-layer contract with the extension. */
  page?: string;
  code?: string;
  session?: string;
  surface?: 'browser' | 'adapter';
  /** Adapter site session lifecycle. Persistent site sessions do not idle-expire. */
  siteSession?: 'ephemeral' | 'persistent';
  url?: string;
  op?: string;
  index?: number;
  domain?: string;
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
  /** Override viewport width in CSS pixels for screenshot (0 / undefined = use current) */
  width?: number;
  /** Override viewport height in CSS pixels for screenshot (0 / undefined = use current; ignored when fullPage) */
  height?: number;

  /** Local file paths for set-file-input action */
  files?: string[];
  /** CSS selector for file input element (set-file-input action) */
  selector?: string;
  /** Raw text payload for insert-text action */
  text?: string;
  /** URL substring filter pattern for network capture */
  pattern?: string;
  /** Download wait timeout in milliseconds */
  timeoutMs?: number;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
  /** Window foreground/background policy for owned Browser Bridge containers. */
  windowMode?: 'foreground' | 'background';
  /** Custom idle timeout in seconds for this session. Overrides the default. */
  idleTimeout?: number;
  /** Frame index for cross-frame operations (0-based, from 'frames' action) */
  frameIndex?: number;
  /** Browser profile/context to route the command to. */
  contextId?: string;
}

export interface DaemonResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errorHint?: string;
  /** Page identity (targetId) — present on page-scoped command responses */
  page?: string;
}

export class BrowserCommandError extends Error {
  constructor(message: string, readonly code?: string, readonly hint?: string) {
    super(message);
    this.name = 'BrowserCommandError';
  }
}

export {
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemonShutdown,
  type BrowserProfileStatus,
  type DaemonHealth,
  type DaemonStatus,
};

/**
 * Internal: send a command to the daemon and return the raw `DaemonResult`.
 *
 * Retry policy is explicit:
 * - pre-dispatch bridge/profile errors: run the full daemon/extension ensure
 *   path, then resend with a fresh transport id;
 * - local TypeError before dispatch: same full ensure path, because the daemon
 *   may be stopped/stale and needs spawn/replacement, not just polling;
 * - `command_result_unknown` and AbortError: never retry automatically.
 */
async function sendCommandRaw(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'>,
): Promise<DaemonResult> {
  const maxAttempts = 4;
  let dispatchRecoveryUsed = false;
  let duplicateIdRetryUsed = false;
  let transientRetryUsed = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const id = generateId();
    const rawWindowMode = process.env.OPENCLI_WINDOW;
    const envWindowMode = rawWindowMode === 'foreground' || rawWindowMode === 'background'
      ? rawWindowMode
      : undefined;
    const contextId = params.contextId ?? resolveProfileContextId();
    const windowMode = params.windowMode ?? envWindowMode;
    const command: DaemonCommand = { id, action, ...params, ...(contextId && { contextId }), ...(windowMode && { windowMode }) };
    try {
      const res = await requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        timeout: 30000,
      });

      const result = (await res.json()) as DaemonResult;

      if (result.ok) return result;

      if (result.errorCode === 'command_result_unknown') {
        throw new BrowserCommandError(result.error ?? 'Browser command result is unknown', result.errorCode, result.errorHint);
      }

      if (!dispatchRecoveryUsed && isPreDispatchError(result.errorCode)) {
        dispatchRecoveryUsed = true;
        await ensureBrowserBridgeReady({
          timeoutSeconds: DEFAULT_BROWSER_CONNECT_TIMEOUT,
          contextId,
          verbose: false,
        });
        continue;
      }

      const isDuplicateCommandId = res.status === 409
        && !result.errorCode
        && (result.error ?? '').includes('Duplicate command id');
      if (isDuplicateCommandId && !duplicateIdRetryUsed) {
        duplicateIdRetryUsed = true;
        continue;
      }

      const advice = classifyBrowserError(new Error(result.error ?? ''));
      if (advice.retryable && !transientRetryUsed) {
        transientRetryUsed = true;
        await sleep(advice.delayMs);
        continue;
      }

      throw new BrowserCommandError(result.error ?? 'Daemon command failed', result.errorCode, result.errorHint);
    } catch (err) {
      if (err instanceof BrowserCommandError || err instanceof BrowserConnectError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new BrowserCommandError(
          'Browser command timed out client-side; the page may still have applied it.',
          'command_result_unknown',
          'Inspect the page state before retrying. Idempotent reads are safe to retry; non-idempotent writes may have already happened.',
        );
      }

      if (!dispatchRecoveryUsed && err instanceof TypeError) {
        dispatchRecoveryUsed = true;
        await ensureBrowserBridgeReady({
          timeoutSeconds: DEFAULT_BROWSER_CONNECT_TIMEOUT,
          contextId,
          verbose: false,
        });
        continue;
      }

      if (err instanceof Error) {
        const advice = classifyBrowserError(err);
        if (advice.retryable && !transientRetryUsed) {
          transientRetryUsed = true;
          await sleep(advice.delayMs);
          continue;
        }
      }

      throw err;
    }
  }

  throw new BrowserCommandError('sendCommand: max attempts exhausted', 'max_attempts_exhausted');
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

export async function bindTab(session: string, opts: { contextId?: string } = {}): Promise<unknown> {
  return sendCommand('bind', { session, surface: 'browser', ...opts });
}
