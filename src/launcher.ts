/**
 * Electron app launcher — auto-detect, confirm, launch, and connect.
 *
 * Flow:
 * 1. Probe CDP port → already running with debug? connect directly
 * 2. Detect process → running without CDP? prompt to restart
 * 3. Discover app path → not installed? error
 * 4. Launch with --remote-debugging-port
 * 5. Poll /json until ready
 */

import { execFileSync, spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import type { ElectronAppEntry } from './electron-apps.js';
import { getElectronApp } from './electron-apps.js';
import { confirmPrompt } from './tui.js';
import { CommandExecutionError } from './errors.js';
import { log } from './logger.js';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;
const KILL_GRACE_MS = 3_000;

/**
 * Probe whether a CDP endpoint is listening on the given port.
 * Returns true if http://127.0.0.1:{port}/json responds successfully.
 */
export function probeCDP(port: number, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path: '/json', method: 'GET', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

/**
 * Check if a process with the given name is running.
 * Uses pgrep on macOS/Linux.
 */
export function detectProcess(processName: string): boolean {
  try {
    execFileSync('pgrep', ['-x', processName], { encoding: 'utf-8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Kill a process by name. Sends SIGTERM first, then SIGKILL after grace period.
 */
export function killProcess(processName: string): void {
  try {
    execFileSync('pkill', ['-x', processName], { stdio: 'pipe' });
  } catch {
    // Process may have already exited
  }

  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (!detectProcess(processName)) return;
    execFileSync('sleep', ['0.2'], { stdio: 'pipe' });
  }

  try {
    execFileSync('pkill', ['-9', '-x', processName], { stdio: 'pipe' });
  } catch {
    // Ignore
  }
}

/**
 * Discover the app installation path on macOS.
 * Uses osascript to resolve the app name to a POSIX path.
 * Returns null if the app is not installed.
 */
export function discoverAppPath(displayName: string): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const result = execFileSync('osascript', [
      '-e', `POSIX path of (path to application "${displayName}")`,
    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 });
    return result.trim().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function resolveExecutable(appPath: string, processName: string): string {
  return `${appPath}/Contents/MacOS/${processName}`;
}

export async function launchDetachedApp(executable: string, args: string[], label: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      detached: true,
      stdio: 'ignore',
    });

    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === 'ENOENT') {
        reject(new CommandExecutionError(
          `Could not launch ${label}: executable not found at ${executable}`,
          `Install ${label}, reinstall it, or register a custom app path in ~/.opencli/apps.yaml`,
        ));
        return;
      }

      reject(new CommandExecutionError(
        `Failed to launch ${label}`,
        err.message,
      ));
    };

    child.once('error', onError);
    child.once('spawn', () => {
      child.off('error', onError);
      child.unref();
      resolve();
    });
  });
}

async function pollForReady(port: number): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeCDP(port, 1_000)) return;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new CommandExecutionError(
    `App launched but CDP not available on port ${port} after ${POLL_TIMEOUT_MS / 1000}s`,
    'The app may be slow to start. Try running the command again.',
  );
}

/**
 * Main entry point: resolve an Electron app to a CDP endpoint URL.
 *
 * Returns the endpoint URL: http://127.0.0.1:{port}
 */
export async function resolveElectronEndpoint(site: string): Promise<string> {
  const app = getElectronApp(site);
  if (!app) {
    throw new CommandExecutionError(
      `No Electron app registered for site "${site}"`,
      'Register the app in ~/.opencli/apps.yaml or check the site name.',
    );
  }

  const { port, processName, displayName } = app;
  const label = displayName ?? processName;
  const endpoint = `http://127.0.0.1:${port}`;

  // Step 1: Already running with CDP?
  log.debug(`[launcher] Probing CDP on port ${port}...`);
  if (await probeCDP(port)) {
    log.debug(`[launcher] CDP already available on port ${port}`);
    return endpoint;
  }

  // Step 2: Running without CDP?
  const isRunning = detectProcess(processName);
  if (isRunning) {
    log.debug(`[launcher] ${label} is running but CDP not available`);
    const confirmed = await confirmPrompt(
      `${label} is running but CDP is not enabled. Restart with debug port?`,
      true,
    );
    if (!confirmed) {
      throw new CommandExecutionError(
        `${label} needs to be restarted with CDP enabled.`,
        `Manually restart: kill the app and relaunch with --remote-debugging-port=${port}`,
      );
    }
    process.stderr.write(`  Restarting ${label}...\n`);
    killProcess(processName);
  }

  // Step 3: Discover path
  const appPath = discoverAppPath(label);
  if (!appPath) {
    throw new CommandExecutionError(
      `Could not find ${label} on this machine.`,
      `Install ${label} or register a custom path in ~/.opencli/apps.yaml`,
    );
  }

  // Step 4: Launch
  const executable = resolveExecutable(appPath, processName);
  const args = [`--remote-debugging-port=${port}`, ...(app.extraArgs ?? [])];
  log.debug(`[launcher] Launching: ${executable} ${args.join(' ')}`);
  await launchDetachedApp(executable, args, label);

  // Step 5: Poll for readiness
  process.stderr.write(`  Waiting for ${label} on port ${port}...\n`);
  await pollForReady(port);
  process.stderr.write(`  Connected to ${label} on port ${port}.\n`);

  return endpoint;
}
