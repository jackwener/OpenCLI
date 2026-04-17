/**
 * Browser connection error helpers.
 *
 * Simplified — no more token/extension/CDP classification.
 * The daemon architecture has a single failure mode: daemon not reachable or extension not connected.
 */

import { BrowserConnectError, type BrowserConnectKind } from '../errors.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

/**
 * Unified browser error classification.
 *
 * All transient error detection lives here — daemon-client, pipeline executor,
 * and page retry logic all use this single system instead of maintaining
 * separate pattern lists.
 */

/** Error category — determines which layer should retry. */
export type BrowserErrorKind =
  | 'extension-transient'   // daemon/extension hiccup — daemon-client retries
  | 'target-navigation'     // CDP target invalidated by SPA nav — page-level settle retry
  | 'non-retryable';        // permanent error — no retry

/** How the caller should handle the error. */
export interface RetryAdvice {
  /** Error category — callers use this to decide whether *they* should retry. */
  kind: BrowserErrorKind;
  /** Whether the error is transient and worth retrying. */
  retryable: boolean;
  /** Suggested delay before retry (ms). */
  delayMs: number;
}

/**
 * Extension/daemon transient patterns — service worker restarts, attach races,
 * tab closure, daemon hiccups. These warrant a longer retry delay (~1500ms)
 * because the extension needs time to recover.
 */
const EXTENSION_TRANSIENT_PATTERNS = [
  'Extension disconnected',
  'Extension not connected',
  'attach failed',
  'no longer exists',
  'CDP connection',
  'Daemon command failed',
  'No window with id',
] as const;

/**
 * CDP target navigation patterns — SPA client-side redirects can invalidate the
 * CDP target after chrome.tabs reports 'complete'. These warrant a shorter retry
 * delay (~200ms) because the new document is usually available quickly.
 */
const TARGET_NAVIGATION_PATTERNS = [
  'Inspected target navigated or closed',
] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Classify a browser error and return retry advice.
 *
 * Single source of truth for "is this error transient?" across all layers.
 */
export function classifyBrowserError(err: unknown): RetryAdvice {
  const msg = errorMessage(err);

  // Extension/daemon transient errors — longer recovery time
  if (EXTENSION_TRANSIENT_PATTERNS.some(p => msg.includes(p))) {
    return { kind: 'extension-transient', retryable: true, delayMs: 1500 };
  }

  // CDP target navigation errors — shorter recovery time
  if (TARGET_NAVIGATION_PATTERNS.some(p => msg.includes(p))) {
    return { kind: 'target-navigation', retryable: true, delayMs: 200 };
  }

  // CDP protocol error with target context (e.g., -32000 "target closed")
  if (msg.includes('-32000') && msg.toLowerCase().includes('target')) {
    return { kind: 'target-navigation', retryable: true, delayMs: 200 };
  }

  return { kind: 'non-retryable', retryable: false, delayMs: 0 };
}

/**
 * Check if an error is a transient browser error worth retrying.
 * Convenience wrapper around classifyBrowserError().
 */
export function isTransientBrowserError(err: unknown): boolean {
  return classifyBrowserError(err).retryable;
}

// Re-export so callers don't need to import from two places
export type ConnectFailureKind = BrowserConnectKind;

export function formatBrowserConnectError(kind: ConnectFailureKind, detail?: string): BrowserConnectError {
  switch (kind) {
    case 'daemon-not-running':
      return new BrowserConnectError(
        'Cannot connect to opencli daemon.' + (detail ? `\n\n${detail}` : ''),
        `The daemon should auto-start. If it keeps failing, make sure port ${DEFAULT_DAEMON_PORT} is available.`,
        kind,
      );
    case 'extension-not-connected':
      return new BrowserConnectError(
        'Browser Bridge extension is not connected.' + (detail ? `\n\n${detail}` : ''),
        'Install the extension from GitHub Releases, then reload.',
        kind,
      );
    case 'command-failed':
      return new BrowserConnectError(
        `Browser command failed: ${detail ?? 'unknown error'}`,
        undefined,
        kind,
      );
    default:
      return new BrowserConnectError(
        detail ?? 'Failed to connect to browser',
        undefined,
        kind,
      );
  }
}
