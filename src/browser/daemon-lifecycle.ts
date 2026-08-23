/**
 * Bridge readiness. Chrome parents the host; the CLI never spawns it.
 */

import { spawn } from 'node:child_process';
import { BrowserConnectError } from '../errors.js';
import { waitForBridgeReady } from './bridge-readiness.js';
import { getDaemonHealth, type DaemonHealth } from './daemon-transport.js';
import { installNativeHostManifest } from '../native-manifest.js';

function launchChrome(): void {
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
  if (health.state === 'ready') return health;
  if (health.state === 'profile-required') throw browserConnectErrorFromHealth(health, contextId);

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
    'Then run: opencli host install && opencli doctor',
    health.state === 'stopped' ? 'host-not-running' : 'extension-not-connected',
  );
}
