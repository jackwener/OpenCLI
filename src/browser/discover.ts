/**
 * Daemon discovery — simplified from MCP server path discovery.
 *
 * Only needs to check if the daemon is running. No more file system
 * scanning for @playwright/mcp locations.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { DEFAULT_DAEMON_PORT } from '../constants.js';
import { isDaemonRunning } from './daemon-client.js';

export { isDaemonRunning };

export type ResolvedCdpEndpoint = {
  endpoint?: string;
  source?: 'env' | 'auto';
  requestedByEnv: boolean;
};

function isAutoDiscoveryFlag(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'auto';
}

export function discoverLocalChromeCdpEndpoint(): string | undefined {
  const candidates: string[] = [];

  if (process.env.CHROME_USER_DATA_DIR) {
    candidates.push(path.join(process.env.CHROME_USER_DATA_DIR, 'DevToolsActivePort'));
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(path.join(localAppData, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort'));
    candidates.push(path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'DevToolsActivePort'));
  } else if (process.platform === 'darwin') {
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'DevToolsActivePort'));
    candidates.push(path.join(os.homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'DevToolsActivePort'));
  } else {
    candidates.push(path.join(os.homedir(), '.config', 'google-chrome', 'DevToolsActivePort'));
    candidates.push(path.join(os.homedir(), '.config', 'chromium', 'DevToolsActivePort'));
    candidates.push(path.join(os.homedir(), '.config', 'microsoft-edge', 'DevToolsActivePort'));
  }

  for (const filePath of candidates) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const lines = content.split(/\r?\n/);
      if (lines.length < 2) continue;
      const port = parseInt(lines[0] ?? '', 10);
      const browserPath = lines[1]?.trim() ?? '';
      if (port > 0 && browserPath.startsWith('/devtools/browser/')) {
        return `ws://127.0.0.1:${port}${browserPath}`;
      }
    } catch {
      // Try the next known Chrome profile location.
    }
  }

  return undefined;
}

export function resolveCdpEndpoint(): ResolvedCdpEndpoint {
  const envValue = process.env.OPENCLI_CDP_ENDPOINT?.trim();
  const requestedByEnv = !!envValue;

  if (envValue && !isAutoDiscoveryFlag(envValue)) {
    return {
      endpoint: envValue,
      source: 'env',
      requestedByEnv,
    };
  }

  const discovered = discoverLocalChromeCdpEndpoint();
  if (discovered) {
    return {
      endpoint: discovered,
      source: envValue ? 'env' : 'auto',
      requestedByEnv,
    };
  }

  return { requestedByEnv };
}

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
