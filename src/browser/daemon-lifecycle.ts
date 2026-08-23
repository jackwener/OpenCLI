/**
 * Bridge readiness. Chrome parents the host; the CLI never spawns it.
 */

import { spawn } from 'node:child_process';
import { BrowserConnectError } from '../errors.js';
import { PKG_VERSION } from '../version.js';
import { waitForBridgeReady } from './bridge-readiness.js';
import { getDaemonHealth, type DaemonHealth } from './daemon-transport.js';
import { requestHost } from './host-rpc.js';
import { installNativeHostManifest } from '../native-manifest.js';

export function shouldLaunchChrome(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CI || env.CONTINUOUS_INTEGRATION) return false;
  if (env.OPENCLI_NO_LAUNCH_CHROME === '1') return false;
  return Boolean(process.stdin.isTTY || process.stderr.isTTY);
}

function launchChrome(): void {
  if (!shouldLaunchChrome()) return;
  try {
    if (process.platform === 'darwin') {
      spawn('open', ['-a', 'Google Chrome'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', 'chrome'], { detached: true, stdio: 'ignore' }).unref();
      return;
    }
    spawn('google-chrome', [], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Best-effort: doctor explains how to open Chrome.
  }
}

async function recycleStaleHost(health: DaemonHealth): Promise<boolean> {
  const version = health.status?.hostVersion;
  const sock = health.status?.sock;
  if (!version || version === PKG_VERSION || !sock) return false;
  try {
    await requestHost(sock, { id: `host-exit_${Date.now()}`, action: 'host-exit' }, { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export async function ensureBrowserBridgeReady(
  opts: { timeoutSeconds?: number; contextId?: string; preferredContextId?: string; verbose?: boolean } = {},
): Promise<DaemonHealth> {
  const timeoutSeconds = opts.timeoutSeconds && opts.timeoutSeconds > 0 ? opts.timeoutSeconds : 10;
  const timeoutMs = timeoutSeconds * 1000;
  const verbose = opts.verbose ?? true;
  const contextId = opts.contextId;
  const preferredContextId = opts.preferredContextId;

  try {
    installNativeHostManifest();
  } catch {
    // Install is best-effort; missing Chrome dirs are diagnosed below.
  }

  const health = await getDaemonHealth({ contextId, preferredContextId });
  if (health.state === 'profile-required') throw browserConnectErrorFromHealth(health, contextId);
  if (health.state === 'ready') {
    const recycled = await recycleStaleHost(health);
    if (!recycled) return health;
    // Chrome still holds the native port; do not steal focus with launchChrome.
    const refreshed = await waitForBridgeReady(getDaemonHealth, { timeoutMs, contextId, preferredContextId });
    if (refreshed.state === 'ready') return refreshed;
    throw browserConnectErrorFromHealth(refreshed, contextId);
  }

  if (verbose && (process.env.OPENCLI_VERBOSE || process.stderr.isTTY)) {
    process.stderr.write('⏳ Waiting for Chrome to spawn the OpenCLI host...\n');
    process.stderr.write('   Open Chrome with the OpenCLI extension enabled if it is not already.\n');
  }
  if (health.state === 'stopped' || health.state === 'no-extension') launchChrome();

  const finalHealth = await waitForBridgeReady(getDaemonHealth, { timeoutMs, contextId, preferredContextId });
  if (finalHealth.state === 'ready') return finalHealth;
  throw browserConnectErrorFromHealth(finalHealth, contextId);
}

function browserConnectErrorFromHealth(health: DaemonHealth, contextId?: string): BrowserConnectError {
  if (health.state === 'profile-required') {
    return new BrowserConnectError(
      'Multiple Browser Bridge profiles are connected',
      'Select one with --profile <name>, OPENCLI_PROFILE=<name>, or opencli profile use <name>.\n' +
      'Run opencli profile list to see connected profiles.',
      'profile-required',
    );
  }
  if (health.state === 'profile-disconnected') {
    const label = contextId ?? health.status.contextId ?? 'unknown';
    return new BrowserConnectError(
      `Browser profile "${label}" is not connected`,
      'Open the matching Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
      'profile-disconnected',
    );
  }
  return new BrowserConnectError(
    'Browser Bridge host is not connected',
    'Chrome must be open with the OpenCLI extension enabled. The extension parents the native host.\n' +
    'If the extension is not installed:\n' +
    '  1. Download: https://github.com/jackwener/opencli/releases\n' +
    '  2. Open chrome://extensions → Developer Mode → Load unpacked\n' +
    'Then reload the extension and run: opencli doctor',
    health.state === 'stopped' ? 'host-not-running' : 'extension-not-connected',
  );
}
