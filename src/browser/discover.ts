/**
 * Daemon discovery — checks if the daemon is running.
 */

import { fetchDaemonStatus, isDaemonRunning } from './daemon-client.js';

export { isDaemonRunning };

/**
 * Check daemon status and return connection info.
 */
export async function checkDaemonStatus(opts?: { timeout?: number }): Promise<{
  running: boolean;
  extensionConnected: boolean;
  extensionVersion?: string;
}> {
  const status = await fetchDaemonStatus({ timeout: opts?.timeout ?? 2000 });
  if (!status) {
    return { running: false, extensionConnected: false };
  }
  return {
    running: true,
    extensionConnected: status.extensionConnected,
    extensionVersion: status.extensionVersion,
  };
}
