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
 * First extension version with the command journal (see extension/src/
 * journal.ts). From this version on, re-sending the SAME command id is safe:
 * the executor replays the recorded result instead of re-executing.
 */
const MIN_JOURNAL_EXTENSION_VERSION = '1.0.22';

function versionAtLeast(version: string | null | undefined, min: string): boolean {
  if (!version) return false;
  const a = version.replace(/^v/, '').split('-')[0].split('.').map(Number);
  const b = min.split('.').map(Number);
  if (a.length < 3 || a.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const d = a[i] - (b[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

/** Error codes meaning the executor's outcome is genuinely unknown — never auto-retry. */
const UNKNOWN_OUTCOME_CODES = new Set(['command_result_unknown', 'command_lost', 'result_evicted']);

/** Max transport attempts for one logical command (same id throughout). */
const TRANSPORT_MAX_ATTEMPTS = 4;

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
   * the effective command deadline; kept for older daemons — new code prefers
   * `deadlineAt`.
   */
  timeout?: number;
  /**
   * Absolute command deadline (epoch ms). All hops run on one machine, so
   * every layer derives its remaining budget as `deadlineAt - Date.now()`,
   * absorbing queueing and service-worker wake latency.
   */
  deadlineAt?: number;
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
 * There are exactly two retry classes, with different id semantics:
 *
 * TRANSPORT retries — the SAME command id, so the executor's journal replays
 * an already-executed command instead of re-running it:
 * - fetch failures (daemon down/replaced/crashed): run the ensure path (which
 *   also spawns the daemon and tells us the extension version), then resend.
 *   Requires a journaling extension unless the failure was pre-connect;
 * - pre-dispatch bridge/profile errors and `daemon_shutting_down`;
 * - a duplicate id landing on a still-pending command attaches to it in the
 *   daemon (no re-dispatch), so same-id resends never double-execute.
 *
 * SEMANTIC retry — ONE new logical attempt with a NEW id, only for executor
 * errors that happened before any page code ran (`attach_failed`/`tab_gone`).
 * `target_navigated` is the page layer's decision, not ours.
 *
 * Never retried: `command_result_unknown` / `command_lost` / `result_evicted`
 * (the outcome is genuinely unknown) and client-side AbortError (the shared
 * deadline is already exhausted).
 */
async function sendCommandRaw(
  action: DaemonCommand['action'],
  params: Omit<DaemonCommand, 'id' | 'action'>,
): Promise<DaemonResult> {
  const timeoutSeconds = effectiveCommandTimeoutSeconds(params);
  const deadlineAt = Date.now() + timeoutSeconds * 1000;
  const rawWindowMode = process.env.OPENCLI_WINDOW;
  const envWindowMode = rawWindowMode === 'foreground' || rawWindowMode === 'background'
    ? rawWindowMode
    : undefined;
  const contextId = params.contextId ?? resolveProfileContextId();
  const windowMode = params.windowMode ?? envWindowMode;

  let id = generateId();
  let ensureUsed = false;
  let semanticRetryUsed = false;
  let executorJournaled: boolean | null = null;

  const ensureBridge = async (): Promise<void> => {
    // Bound the connect wait by the command's remaining budget so repeated
    // daemon failures cannot stretch the total wall time far past --timeout.
    const remainingSeconds = Math.ceil((deadlineAt - Date.now()) / 1000);
    const ready = await ensureBrowserBridgeReady({
      timeoutSeconds: Math.max(1, Math.min(DEFAULT_BROWSER_CONNECT_TIMEOUT, remainingSeconds)),
      contextId,
      verbose: false,
    });
    executorJournaled = versionAtLeast(ready.health.status?.extensionVersion, MIN_JOURNAL_EXTENSION_VERSION);
  };

  for (let attempt = 1; attempt <= TRANSPORT_MAX_ATTEMPTS; attempt++) {
    if (attempt > 1 && Date.now() >= deadlineAt) {
      throw new BrowserCommandError(
        'Browser command deadline exhausted across transport retries.',
        COMMAND_RESULT_UNKNOWN_CODE,
        COMMAND_RESULT_UNKNOWN_HINT,
      );
    }
    const remainingMs = Math.max(1000, deadlineAt - Date.now());
    const command: DaemonCommand = {
      id,
      action,
      ...params,
      timeout: timeoutSeconds,
      deadlineAt,
      ...(contextId && { contextId }),
      ...(windowMode && { windowMode }),
    };
    try {
      const res = await requestDaemon('/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
        timeout: remainingMs + HTTP_TIMEOUT_MARGIN_MS,
      });

      const result = (await res.json()) as DaemonResult;

      if (result.ok) return result;

      if (result.errorCode && UNKNOWN_OUTCOME_CODES.has(result.errorCode)) {
        throw new BrowserCommandError(result.error ?? 'Browser command result is unknown', result.errorCode, result.errorHint);
      }

      if (isPreDispatchError(result.errorCode) && !ensureUsed) {
        // Never dispatched — resending the same id is safe on any extension.
        ensureUsed = true;
        await ensureBridge();
        continue;
      }

      if (result.errorCode === 'daemon_shutting_down' && !ensureUsed) {
        // The command WAS dispatched and the daemon died before the result
        // came back. Resending the same id is only safe when the extension
        // journals ids; otherwise the outcome is genuinely unknown.
        ensureUsed = true;
        await ensureBridge();
        if (executorJournaled) continue;
        throw new BrowserCommandError(
          result.error ?? 'Daemon shut down mid-command; the command may have already been applied.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
      }

      const advice = classifyBrowserError(new BrowserCommandError(result.error ?? '', result.errorCode));
      if (advice.kind === 'extension-transient' && !semanticRetryUsed) {
        semanticRetryUsed = true;
        id = generateId();
        await sleep(advice.delayMs);
        continue;
      }

      throw new BrowserCommandError(result.error ?? 'Daemon command failed', result.errorCode, result.errorHint);
    } catch (err) {
      if (err instanceof BrowserCommandError || err instanceof BrowserConnectError) throw err;

      if (err instanceof Error && err.name === 'AbortError') {
        throw new BrowserCommandError(
          'Browser command timed out client-side; the page may still have applied it.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
      }

      if (err instanceof TypeError) {
        // Transport failure — the request may or may not have reached the
        // daemon. Bring the bridge back up (spawns a daemon if none is
        // running) and learn whether the extension journals command ids.
        await ensureBridge();
        // Same-id resend is safe when the request never connected, or when
        // the executor dedupes ids. Otherwise the outcome is unknown.
        if (executorJournaled || isPreConnectFetchError(err)) continue;
        throw new BrowserCommandError(
          'Connection to the daemon was lost mid-command; it may have already been applied.',
          COMMAND_RESULT_UNKNOWN_CODE,
          COMMAND_RESULT_UNKNOWN_HINT,
        );
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
