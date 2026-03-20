import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import {
  defaultTemporaryUserDataDir,
  registerLaunchedBrowser,
  type BrowserLaunchMode,
  type BrowserUserDataKind,
  unregisterLaunchedBrowser,
} from './instances.js';
import { normalizeProfileName, resolvePersistentProfileDir } from './profiles.js';

export interface BrowserLaunchOptions {
  browser?: string;
  browserArgs?: string[];
  port?: number;
  url?: string;
  profile?: string;
  temporaryProfileSeed?: string;
  headless?: boolean;
  timeoutMs?: number;
  foreground?: boolean;
}

export interface BrowserLaunchPlan {
  executable: string;
  args: string[];
  endpoint: string;
  userDataDir: string;
  profileName?: string;
  userDataKind: BrowserUserDataKind;
}

export interface BrowserLaunchResult extends BrowserLaunchPlan {
  pid: number;
  launchMode: BrowserLaunchMode;
  browserName?: string;
  webSocketDebuggerUrl?: string;
  exitPromise?: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

const DEFAULT_CDP_PORT = 9222;
const DEFAULT_CDP_TIMEOUT_MS = 15_000;

function isExecutableFile(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(binary: string): string | undefined {
  const pathValue = process.env.PATH ?? '';
  const pathDirs = pathValue.split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = path.join(dir, binary);
    if (isExecutableFile(candidate)) return candidate;
    if (process.platform === 'win32') {
      const exeCandidate = `${candidate}.exe`;
      if (isExecutableFile(exeCandidate)) return exeCandidate;
    }
  }
  return undefined;
}

function normalizeBrowserArgs(args?: string[]): string[] {
  if (!args?.length) return [];

  return args.map((arg) => {
    const normalized = arg.trim();
    if (!normalized) {
      throw new Error('Browser launch arguments cannot be empty.');
    }
    return normalized;
  });
}

export function resolveBrowserExecutable(explicit?: string, platform: NodeJS.Platform = process.platform): string {
  if (explicit) {
    if (explicit.includes(path.sep) || path.isAbsolute(explicit)) {
      if (!isExecutableFile(explicit)) throw new Error(`Browser executable not found or not executable: ${explicit}`);
      return explicit;
    }
    const fromPath = findInPath(explicit);
    if (fromPath) return fromPath;
    throw new Error(`Browser executable not found in PATH: ${explicit}`);
  }

  const candidates = platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      ]
    : platform === 'win32'
      ? [
          path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];

  for (const candidate of candidates) {
    if (platform === 'darwin' || platform === 'win32') {
      if (isExecutableFile(candidate)) return candidate;
      continue;
    }
    const resolved = findInPath(candidate);
    if (resolved) return resolved;
  }

  throw new Error(
    'Could not locate a Chrome/Chromium executable automatically. Pass --browser <path> to specify one explicitly.',
  );
}

export function buildLaunchPlan(opts: BrowserLaunchOptions = {}): BrowserLaunchPlan {
  const port = Number(opts.port ?? DEFAULT_CDP_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid CDP port: ${opts.port}`);
  }

  const executable = resolveBrowserExecutable(opts.browser);
  const profileName = opts.profile ? normalizeProfileName(opts.profile) : undefined;
  const userDataDir = path.resolve(
    profileName
      ? resolvePersistentProfileDir(profileName)
      : defaultTemporaryUserDataDir(port, opts.temporaryProfileSeed),
  );
  const userDataKind: BrowserUserDataKind = profileName ? 'persistent' : 'temporary';
  const endpoint = `http://127.0.0.1:${port}`;
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--new-window',
  ];

  if (opts.headless) {
    args.push('--headless=new', '--disable-gpu');
  }

  args.push(...normalizeBrowserArgs(opts.browserArgs));
  args.push(opts.url ?? 'about:blank');

  return { executable, args, endpoint, userDataDir, profileName, userDataKind };
}

export async function isTcpPortOpen(port: number, host: string = '127.0.0.1', timeoutMs: number = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function waitForCdpEndpoint(endpoint: string, timeoutMs: number): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) return await res.json();
      lastError = new Error(`CDP endpoint returned HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw lastError instanceof Error
    ? new Error(`Timed out waiting for CDP endpoint: ${lastError.message}`)
    : new Error(`Timed out waiting for CDP endpoint: ${endpoint}`);
}

function waitForChildExit(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

async function cleanupTemporaryUserDataDir(plan: BrowserLaunchPlan): Promise<void> {
  if (plan.userDataKind !== 'temporary') return;
  await fs.promises.rm(plan.userDataDir, { recursive: true, force: true });
}

function terminateChildProcess(child?: ChildProcess): void {
  if (!child?.pid) return;
  try {
    process.kill(child.pid, 'SIGTERM');
  } catch {
    // Ignore failures here; launch errors will surface from the original path.
  }
}

export async function launchDebugBrowser(opts: BrowserLaunchOptions = {}): Promise<BrowserLaunchResult> {
  const plan = buildLaunchPlan(opts);
  const port = Number(new URL(plan.endpoint).port);
  if (await isTcpPortOpen(port)) {
    throw new Error(`CDP port ${port} is already in use. Pick another port with --port.`);
  }

  await fs.promises.mkdir(plan.userDataDir, { recursive: true });
  const launchMode: BrowserLaunchMode = opts.foreground ? 'foreground' : 'background';
  let child: ChildProcess | undefined;

  try {
    child = spawn(plan.executable, plan.args, {
      detached: !opts.foreground,
      stdio: opts.foreground ? 'inherit' : 'ignore',
      env: { ...process.env },
    });
    const exitPromise = opts.foreground ? waitForChildExit(child) : undefined;
    if (!opts.foreground) child.unref();

    const info = await waitForCdpEndpoint(plan.endpoint, opts.timeoutMs ?? DEFAULT_CDP_TIMEOUT_MS);
    await registerLaunchedBrowser({
      pid: child.pid ?? -1,
      port,
      endpoint: plan.endpoint,
      profileName: plan.profileName,
      userDataDir: plan.userDataDir,
      userDataKind: plan.userDataKind,
      launchMode,
      browserName: info?.Browser,
      webSocketDebuggerUrl: info?.webSocketDebuggerUrl,
    });

    if (opts.foreground && exitPromise) {
      void exitPromise.then(async () => {
        await unregisterLaunchedBrowser(port);
        await cleanupTemporaryUserDataDir(plan);
      }).catch(() => {});
    }

    return {
      ...plan,
      pid: child.pid ?? -1,
      launchMode,
      browserName: info?.Browser,
      webSocketDebuggerUrl: info?.webSocketDebuggerUrl,
      exitPromise,
    };
  } catch (err) {
    terminateChildProcess(child);
    await cleanupTemporaryUserDataDir(plan).catch(() => {});
    throw err;
  }
}
