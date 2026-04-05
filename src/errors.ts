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
 *   1   Generic / unexpected error      (ApiError, SelectorError)
 *   2   Argument / usage error          (ArgumentError)
 *  66   No input / empty result         (EmptyResultError, PageChangedError)
 *  69   Service unavailable             (BrowserConnectError, AdapterLoadError)
 *  75   Temporary failure, retry later  (TimeoutError, NetworkError)   EX_TEMPFAIL
 *  77   Permission denied / auth needed (AuthRequiredError)
 *  78   Configuration error             (ConfigError)
 * 130   Interrupted by Ctrl-C           (set by tui.ts SIGINT handler)
 */

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

// ── Typed subclasses ─────────────────────────────────────────────────────────

export type BrowserConnectKind = 'daemon-not-running' | 'extension-not-connected' | 'command-failed' | 'unknown';

export class BrowserConnectError extends CliError {
  readonly kind: BrowserConnectKind;
  constructor(message: string, hint?: string, kind: BrowserConnectKind = 'unknown') {
    super('BROWSER_CONNECT', message, hint, EXIT_CODES.SERVICE_UNAVAIL);
    this.kind = kind;
  }
}

export class AdapterLoadError extends CliError {
  constructor(message: string, hint?: string) {
    super('ADAPTER_LOAD', message, hint, EXIT_CODES.SERVICE_UNAVAIL);
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

export class SelectorError extends CliError {
  constructor(selector: string, hint?: string) {
    super(
      'SELECTOR',
      `Could not find element: ${selector}`,
      hint ?? 'The page UI may have changed. Please report this issue.',
      EXIT_CODES.GENERIC_ERROR,
    );
  }
}

export class NetworkError extends CliError {
  readonly statusCode?: number;
  constructor(message: string, statusCode?: number, hint?: string) {
    super(
      'NETWORK',
      message,
      hint ?? 'Check your network connection, or try again later',
      EXIT_CODES.TEMPFAIL,
    );
    this.statusCode = statusCode;
  }
}

export class ApiError extends CliError {
  readonly apiCode?: number | string;
  constructor(label: string, apiCode?: number | string, apiMessage?: string, hint?: string) {
    super(
      'API_ERROR',
      `${label}: API error${apiCode !== undefined ? ` code=${apiCode}` : ''}${apiMessage ? ` — ${apiMessage}` : ''}`,
      hint ?? 'The API returned an unexpected error. The endpoint may have changed.',
      EXIT_CODES.GENERIC_ERROR,
    );
    this.apiCode = apiCode;
  }
}

export class PageChangedError extends CliError {
  constructor(command: string, hint?: string) {
    super(
      'PAGE_CHANGED',
      `${command}: page structure has changed`,
      hint ?? 'The website may have been updated. Please report this issue so the adapter can be fixed.',
      EXIT_CODES.EMPTY_RESULT,
    );
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

/** Extract a human-readable message from an unknown caught value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Error code → emoji mapping for CLI output rendering. */
export const ERROR_ICONS: Record<string, string> = {
  AUTH_REQUIRED:   '🔒',
  BROWSER_CONNECT: '🔌',
  TIMEOUT:         '⏱ ',
  ARGUMENT:        '❌',
  EMPTY_RESULT:    '📭',
  SELECTOR:        '🔍',
  COMMAND_EXEC:    '💥',
  ADAPTER_LOAD:    '📦',
  NETWORK:         '🌐',
  API_ERROR:       '🚫',
  RATE_LIMITED:    '⏳',
  PAGE_CHANGED:    '🔄',
  CONFIG:          '⚙️ ',
};
