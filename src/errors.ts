/**
 * Unified error types for opencli.
 *
 * All errors thrown by the framework should extend CliError so that
 * the top-level handler in commanderAdapter.ts can render consistent,
 * helpful output with emoji-coded severity and actionable hints.
 */

export class CliError extends Error {
  /** Machine-readable error code (e.g. 'BROWSER_CONNECT', 'AUTH_REQUIRED') */
  readonly code: string;
  /** Human-readable hint on how to fix the problem */
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.hint = hint;
  }
}

export type BrowserConnectKind = 'daemon-not-running' | 'extension-not-connected' | 'command-failed' | 'unknown';

export class BrowserConnectError extends CliError {
  readonly kind: BrowserConnectKind;
  constructor(message: string, hint?: string, kind: BrowserConnectKind = 'unknown') {
    super('BROWSER_CONNECT', message, hint);
    this.kind = kind;
  }
}

export class AdapterLoadError extends CliError {
  constructor(message: string, hint?: string) { super('ADAPTER_LOAD', message, hint); }
}

export class CommandExecutionError extends CliError {
  constructor(message: string, hint?: string) { super('COMMAND_EXEC', message, hint); }
}

export class ConfigError extends CliError {
  constructor(message: string, hint?: string) { super('CONFIG', message, hint); }
}

export class AuthRequiredError extends CliError {
  readonly domain: string;
  constructor(domain: string, message?: string) {
    super('AUTH_REQUIRED', message ?? `Not logged in to ${domain}`, `Please open Chrome and log in to https://${domain}`);
    this.domain = domain;
  }
}

export class TimeoutError extends CliError {
  constructor(label: string, seconds: number, hint?: string) {
    super(
      'TIMEOUT',
      `${label} timed out after ${seconds}s`,
      hint ?? 'Try again, or increase timeout with OPENCLI_BROWSER_COMMAND_TIMEOUT env var',
    );
  }
}

export class ArgumentError extends CliError {
  constructor(message: string, hint?: string) { super('ARGUMENT', message, hint); }
}

export class EmptyResultError extends CliError {
  constructor(command: string, hint?: string) {
    super('EMPTY_RESULT', `${command} returned no data`, hint ?? 'The page structure may have changed, or you may need to log in');
  }
}

export class SelectorError extends CliError {
  constructor(selector: string, hint?: string) {
    super('SELECTOR', `Could not find element: ${selector}`, hint ?? 'The page UI may have changed. Please report this issue.');
  }
}

// ── Utilities ───────────────────────────────────────────────────────────

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
