/**
 * Daemon discovery — simplified from MCP server path discovery.
 *
 * Only needs to check if the daemon is running. No more file system
 * scanning for @playwright/mcp locations.
 */

import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { isDaemonRunning } from './daemon-client.js';

export { isDaemonRunning };

/**
 * Check daemon status and return connection info.
 */
export async function checkDaemonStatus(): Promise<{
  running: boolean;
  extensionConnected: boolean;
}> {
  try {
    const port = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
    const res = await fetch(`http://127.0.0.1:${port}/status`, {
      headers: { 'X-OpenCLI': '1' },
    });
    const data = await res.json() as { ok: boolean; extensionConnected: boolean };
    return { running: true, extensionConnected: data.extensionConnected };
  } catch {
    return { running: false, extensionConnected: false };
  }
}
