/**
 * Browser connection error helpers.
 *
 * Simplified — no more token/extension/CDP classification.
 * The daemon architecture has a single failure mode: daemon not reachable or extension not connected.
 */

import { BrowserConnectError } from '../errors.js';
import { DEFAULT_DAEMON_PORT } from '../constants.js';

export type ConnectFailureKind = 'daemon-not-running' | 'extension-not-connected' | 'command-failed' | 'unknown';

export function formatBrowserConnectError(kind: ConnectFailureKind, detail?: string): BrowserConnectError {
  switch (kind) {
    case 'daemon-not-running':
      return new BrowserConnectError(
        'Cannot connect to opencli daemon.' +
        (detail ? `\n\n${detail}` : ''),
        'The daemon should start automatically. If it doesn\'t, try:\n' +
        '  node dist/daemon.js\n' +
        `Make sure port ${DEFAULT_DAEMON_PORT} is available.`,
      );
    case 'extension-not-connected':
      return new BrowserConnectError(
        'opencli Browser Bridge extension is not connected.' +
        (detail ? `\n\n${detail}` : ''),
        'Please install the extension:\n' +
        '  1. Download from GitHub Releases\n' +
        '  2. Open chrome://extensions/ → Enable Developer Mode\n' +
        '  3. Click "Load unpacked" → select the extension folder\n' +
        '  4. Make sure Chrome is running',
      );
    case 'command-failed':
      return new BrowserConnectError(
        `Browser command failed: ${detail ?? 'unknown error'}`,
      );
    default:
      return new BrowserConnectError(
        detail ?? 'Failed to connect to browser',
      );
  }
}
