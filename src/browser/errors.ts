/**
 * Browser connection error helpers.
 *
 * Simplified — no more token/extension/CDP classification.
 * The daemon architecture has a single failure mode: daemon not reachable or extension not connected.
 */

import { BrowserConnectError, type BrowserConnectKind } from '../errors.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

/**
 * Transient browser error patterns — shared across daemon-client, pipeline executor,
 * and page retry logic. These errors indicate temporary conditions (extension restart,
 * service worker cycle, tab navigation) that are worth retrying.
 */
const TRANSIENT_ERROR_PATTERNS = [
  'Extension disconnected',
  'Extension not connected',
  'attach failed',
  'no longer exists',
  'CDP connection',
  'Daemon command failed',
] as const;

/**
 * Check if an error message indicates a transient browser error worth retrying.
 */
export function isTransientBrowserError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR_PATTERNS.some(pattern => msg.includes(pattern));
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
