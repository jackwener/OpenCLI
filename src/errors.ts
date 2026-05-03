/**
 * Unified error types for opencli.
 *
 * All errors thrown by the framework should extend CliError so that
 * the top-level handler in commanderAdapter.ts can render consistent,
 * helpful output with emoji-coded severity and actionable hints.
 *
 * ## Exit codes
 *
 * opencli follows Unix conventions (sysexits.h) for process exit codes:
 *
 *   0   Success
 *   1   Generic / unexpected error
 *   2   Argument / usage error          (ArgumentError)
 *  66   No input / empty result         (EmptyResultError)
 *  69   Service unavailable             (BrowserConnectError, adapter load failures)
 *  75   Temporary failure, retry later  (TimeoutError)   EX_TEMPFAIL
 *  77   Permission denied / auth needed (AuthRequiredError)
 *  78   Configuration error             (ConfigError)
 * 130   Interrupted by Ctrl-C           (set by tui.ts SIGINT handler)
 */
import type { ObservationTraceReceipt } from './observation/events.js';

// ── Exit code table ──────────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS:         0,
  GENERIC_ERROR:   1,
  USAGE_ERROR:     2,   // Bad arguments / command misuse
  EMPTY_RESULT:   66,   // No data / not found           (EX_NOINPUT)
  SERVICE_UNAVAIL:69,   // Daemon / browser unavailable  (EX_UNAVAILABLE)
  TEMPFAIL:       75,   // Timeout — try again later     (EX_TEMPFAIL)
  NOPERM:         77,   // Auth required / permission    (EX_NOPERM)
  CONFIG_ERROR:   78,   // Missing / invalid config      (EX_CONFIG)
  INTERRUPTED:   130,   // Ctrl-C / SIGINT
} as const;

export type ExitCode = typeof EXIT_CODES[keyof typeof EXIT_CODES];

// ── Base class ───────────────────────────────────────────────────────────────

export class CliError extends Error {
  /** Machine-readable error code (e.g. 'BROWSER_CONNECT', 'AUTH_REQUIRED') */
  readonly code: string;
  /** Human-readable hint on how to fix the problem */
  readonly hint?: string;
  /** Unix process exit code — defaults to 1 (generic error) */
  readonly exitCode: ExitCode;

  constructor(code: string, message: string, hint?: string, exitCode: ExitCode = EXIT_CODES.GENERIC_ERROR) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.hint = hint;
    this.exitCode = exitCode;
  }
}

const TRACE_RECEIPT_SYMBOL = Symbol.for('opencli.traceReceipt');

export function attachTraceReceipt(err: unknown, receipt: ObservationTraceReceipt): void {
  if (!err || (typeof err !== 'object' && typeof err !== 'function')) return;
  try {
    Object.defineProperty(err, TRACE_RECEIPT_SYMBOL, {
      value: receipt,
      enumerable: false,
      configurable: true,
    });
  } catch {
    // Non-extensible thrown objects are rare; trace export should never mask the
    // original adapter error just because metadata attachment failed.
  }
}

export function getTraceReceipt(err: unknown): ObservationTraceReceipt | undefined {
  if (!err || (typeof err !== 'object' && typeof err !== 'function')) return undefined;
  return (err as Record<PropertyKey, unknown>)[TRACE_RECEIPT_SYMBOL] as ObservationTraceReceipt | undefined;
}

// ── Typed subclasses ─────────────────────────────────────────────────────────

export type BrowserConnectKind = 'daemon-not-running' | 'extension-not-connected' | 'profile-required' | 'profile-disconnected' | 'command-failed' | 'unknown';

export class BrowserConnectError extends CliError {
  readonly kind: BrowserConnectKind;
  constructor(message: string, hint?: string, kind: BrowserConnectKind = 'unknown') {
    super('BROWSER_CONNECT', message, hint, EXIT_CODES.SERVICE_UNAVAIL);
    this.kind = kind;
  }
}

export class CommandExecutionError extends CliError {
  constructor(message: string, hint?: string) {
    super('COMMAND_EXEC', message, hint, EXIT_CODES.GENERIC_ERROR);
  }
}

export class ConfigError extends CliError {
  constructor(message: string, hint?: string) {
    super('CONFIG', message, hint, EXIT_CODES.CONFIG_ERROR);
  }
}

export class AuthRequiredError extends CliError {
  readonly domain: string;
  constructor(domain: string, message?: string) {
    super(
      'AUTH_REQUIRED',
      message ?? `Not logged in to ${domain}`,
      `Please open Chrome or Chromium and log in to https://${domain}`,
      EXIT_CODES.NOPERM,
    );
    this.domain = domain;
  }
}

export class TimeoutError extends CliError {
  constructor(label: string, seconds: number, hint?: string) {
    super(
      'TIMEOUT',
      `${label} timed out after ${seconds}s`,
      hint ?? 'Try again, or increase timeout with OPENCLI_BROWSER_COMMAND_TIMEOUT env var',
      EXIT_CODES.TEMPFAIL,
    );
  }
}

export class ArgumentError extends CliError {
  constructor(message: string, hint?: string) {
    super('ARGUMENT', message, hint, EXIT_CODES.USAGE_ERROR);
  }
}

export class EmptyResultError extends CliError {
  constructor(command: string, hint?: string) {
    super(
      'EMPTY_RESULT',
      `${command} returned no data`,
      hint ?? 'The page structure may have changed, or you may need to log in',
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

export function adapterLoadError(message: string, hint?: string): CliError {
  return new CliError('ADAPTER_LOAD', message, hint, EXIT_CODES.SERVICE_UNAVAIL);
}

export function selectorError(selector: string, hint?: string): CliError {
  return new CliError(
    'SELECTOR',
    `Could not find element: ${selector}`,
    hint ?? 'The page UI may have changed. Please report this issue.',
    EXIT_CODES.GENERIC_ERROR,
  );
}

export class PluginError extends CliError {
  constructor(message: string, hint?: string) {
    super('PLUGIN', message, hint, EXIT_CODES.GENERIC_ERROR);
  }
}

// ── Error Envelope ──────────────────────────────────────────────────────────

/** Structured error output — unified contract for all consumers (AI agents, scripts, humans). */
export interface ErrorEnvelope {
  ok: false;
  error: {
    code: string;
    message: string;
    help?: string;
    exitCode: number;
    stack?: string;
    cause?: string;
  };
  trace?: {
    traceId: string;
    dir: string;
    summaryPath: string;
    receiptPath: string;
    status: ObservationTraceReceipt['status'];
  };
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown caught value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Serialize an error cause chain into a readable string. */
function serializeCause(cause: unknown, depth: number = 0): string {
  if (depth > 10) return '(cause chain truncated)';
  if (cause instanceof Error) {
    const parts = [cause.message];
    if (cause.cause) parts.push(`  caused by: ${serializeCause(cause.cause, depth + 1)}`);
    return parts.join('\n');
  }
  return String(cause);
}

/** Build an ErrorEnvelope from any caught value. */
export function toEnvelope(err: unknown): ErrorEnvelope {
  const cause = err instanceof Error && err.cause ? serializeCause(err.cause) : undefined;
  const traceReceipt = getTraceReceipt(err);
  const trace = traceReceipt ? {
    traceId: traceReceipt.traceId,
    dir: traceReceipt.traceDir,
    summaryPath: traceReceipt.summaryPath,
    receiptPath: traceReceipt.receiptPath,
    status: traceReceipt.status,
  } : undefined;
  if (err instanceof CliError) {
    return {
      ok: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.hint ? { help: err.hint } : {}),
        exitCode: err.exitCode,
        ...(cause ? { cause } : {}),
      },
      ...(trace ? { trace } : {}),
    };
  }
  const msg = getErrorMessage(err);
  return {
    ok: false,
    error: {
      code: 'UNKNOWN',
      message: msg,
      exitCode: EXIT_CODES.GENERIC_ERROR,
      ...(cause ? { cause } : {}),
    },
    ...(trace ? { trace } : {}),
  };
}
