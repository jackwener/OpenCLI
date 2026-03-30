/**
 * Daemon discovery — simplified from MCP server path discovery.
 *
 * Only needs to check if the daemon is running. No more file system
 * scanning for @playwright/mcp locations.
 */

import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { buildDaemonAuthHeaders, isDaemonRunning, resetTokenCache } from './daemon-client.js';

export { isDaemonRunning };

/**
 * Check daemon status and return connection info.
 */
export async function checkDaemonStatus(opts?: { timeout?: number }): Promise<{
  running: boolean;
  extensionConnected: boolean;
  extensionVersion?: string;
}> {
  try {
    const port = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);
    const requestStatus = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts?.timeout ?? 2000);
      try {
        return await fetch(`http://127.0.0.1:${port}/status`, {
          headers: buildDaemonAuthHeaders(),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let res = await requestStatus();
    if (res.status === 401) {
      resetTokenCache();
      res = await requestStatus();
    }

    if (!res.ok) {
      return { running: true, extensionConnected: false };
    }

    try {
      const data = await res.json() as { ok: boolean; extensionConnected: boolean; extensionVersion?: string };
      return { running: true, extensionConnected: !!data.extensionConnected, extensionVersion: data.extensionVersion };
    } catch {
      return { running: true, extensionConnected: false };
    }
  } catch {
    return { running: false, extensionConnected: false };
  }
}
