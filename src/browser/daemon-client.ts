/**
 * HTTP client for communicating with the opencli daemon.
 *
 * Provides a typed send() function that posts a Command and returns a Result.
 */

import { sleep } from '../utils.js';
import { BrowserConnectError } from '../errors.js';
import { COMMAND_RESULT_UNKNOWN_CODE, COMMAND_RESULT_UNKNOWN_HINT } from '../daemon-utils.js';
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

/**
 * Transport-level deadlines share one source of truth: `body.timeout` (seconds).
 * The daemon arms its per-command timer from it, the extension derives its CDP
 * deadline from the same value, and the client HTTP abort fires only after the
 * daemon's structured timeout response should have arrived — so failures
 * surface innermost-first (extension < daemon < client) with a real error
 * instead of an opaque client-side AbortError.
 */
const DEFAULT_COMMAND_TIMEOUT_SECONDS = 120;
/** Headroom past an extension-side operation's own timer (e.g. wait-download). */
const EXTENSION_OP_TIMEOUT_MARGIN_MS = 15_000;
/** Client aborts only this long after the daemon timer should have fired. */
const HTTP_TIMEOUT_MARGIN_MS = 10_000;

let _userCommandTimeoutSeconds: number | null = null;

/**
 * Propagate the user's `--timeout` down to the transport layer. Without this
 * the daemon/HTTP deadlines stay at their defaults and a long-running command
 * gets aborted mid-flight even though the user explicitly allowed more time.
 */
export function setDaemonCommandTimeoutSeconds(seconds: number | null): void {
  _userCommandTimeoutSeconds = typeof seconds === 'number' && seconds > 0 ? Math.ceil(seconds) : null;
}

function effectiveCommandTimeoutSeconds(params: Omit<DaemonCommand, 'id' | 'action'>): number {
  const base = _userCommandTimeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS;
  if (typeof params.timeoutMs === 'number' && params.timeoutMs > 0) {
    return Math.max(base, Math.ceil((params.timeoutMs + EXTENSION_OP_TIMEOUT_MARGIN_MS) / 1000));
  }
  return base;
}

/**
 * undici surfaces network failures as `TypeError: fetch failed` with the real
 * error in `.cause` (possibly an AggregateError). Only failures that happen
 * before the request could reach the daemon are safe to auto-retry — a reset
 * or hang-up after connect means the daemon may have already dispatched the
 * command to the browser.
 */
const PRE_CONNECT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
]);

function isPreConnectFetchError(err: unknown): boolean {
  const queue: unknown[] = [err];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    const { code, cause, errors } = current as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof code === 'string' && PRE_CONNECT_ERROR_CODES.has(code)) return true;
    if (cause) queue.push(cause);
    if (Array.isArray(errors)) queue.push(...errors);
  }
  return false;
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
  /**
   * Daemon-side command timeout in seconds. Set by the transport layer from
   * the effective command deadline; the extension derives its CDP deadline
   * from the same value.
   */
  timeout?: number;
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
 * - fetch TypeError whose cause is a pre-connect failure (ECONNREFUSED etc.):
 *   same full ensure path, because the daemon may be stopped/stale and needs
 *   spawn/replacement — the request never reached it, so resending is safe;
 * - fetch TypeError after connect (ECONNRESET / socket hang-up): NOT retried —
 *   the daemon may have already dispatched the command to the browser, so this
 *   surfaces as `command_result_unknown` instead of risking a double write;
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
    const timeoutSeconds = effectiveCommandTimeoutSeconds(params);
    const command: DaemonCommand = {
      id,
      action,
      ...params,
      timeout: timeoutSeconds,
      ...(contextId && { contextId }),
      ...(windowMode && { windowMode }),
    };
    try {
      const res = await requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        timeout: timeoutSeconds * 1000 + HTTP_TIMEOUT_MARGIN_MS,
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

      if (err instanceof TypeError) {
        if (!isPreConnectFetchError(err)) {
          // Connection dropped after the request may have reached the daemon
          // (ECONNRESET / socket hang-up) — the command may already be running
          // in the browser, so resending would risk a double write.
          throw new BrowserCommandError(
            'Connection to the daemon was lost mid-command; it may have already been applied.',
            COMMAND_RESULT_UNKNOWN_CODE,
            COMMAND_RESULT_UNKNOWN_HINT,
          );
        }
        if (!dispatchRecoveryUsed) {
          dispatchRecoveryUsed = true;
          await ensureBrowserBridgeReady({
            timeoutSeconds: DEFAULT_BROWSER_CONNECT_TIMEOUT,
            contextId,
            verbose: false,
          });
          continue;
        }
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
