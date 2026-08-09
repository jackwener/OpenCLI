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
import * as fs from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import * as path from 'node:path';
import type { ElectronAppEntry } from './electron-apps.js';
import { getElectronApp } from './electron-apps.js';
import { confirmPrompt } from './tui.js';
import { CommandExecutionError } from './errors.js';
import { log } from './logger.js';

const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 2_000;
const KILL_GRACE_MS = 3_000;
const MAX_CDP_RESPONSE_BYTES = 1_000_000;

interface WindowsProcessRow {
  pid: number;
  executablePath: string | null;
  commandLine: string | null;
}

type ElectronAppPathEntry = Pick<
  ElectronAppEntry,
  'processName' | 'displayName' | 'bundleId' | 'executableNames' | 'windowsInstallDirs'
>;

function parsePgrepOutput(output: string): number[] {
  return output
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function cdpTargetsMatchHosts(body: string, expectedHosts: readonly string[]): boolean {
  if (expectedHosts.length === 0) return true;

  try {
    const targets = JSON.parse(body) as unknown;
    if (!Array.isArray(targets)) return false;
    const normalizedHosts = expectedHosts.map((host) => host.toLowerCase());
    return targets.some((target) => {
      if (!target || typeof target !== 'object' || !('url' in target) || typeof target.url !== 'string') return false;
      try {
        const hostname = new URL(target.url).hostname.toLowerCase();
        return normalizedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function windowsProcessQuery(processName: string): string {
  const escapedName = processName.replace(/'/g, "''");
  return `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$targetName = '${escapedName}'
@(
  Get-CimInstance Win32_Process |
    Where-Object { $_.Name -ieq $targetName } |
    ForEach-Object {
      [pscustomobject]@{
        ProcessId = $_.ProcessId
        ExecutablePath = $_.ExecutablePath
        CommandLine = $_.CommandLine
      }
    }
) | ConvertTo-Json -Compress
`;
}

function parseWindowsProcessOutput(output: string): WindowsProcessRow[] {
  if (!output.trim()) return [];
  try {
    const parsed = JSON.parse(output) as unknown;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.flatMap((row) => {
      if (!row || typeof row !== 'object') return [];
      const raw = row as Record<string, unknown>;
      const pid = Number(raw.ProcessId);
      if (!Number.isInteger(pid) || pid <= 0) return [];
      return [{
        pid,
        executablePath: typeof raw.ExecutablePath === 'string' && raw.ExecutablePath ? raw.ExecutablePath : null,
        commandLine: typeof raw.CommandLine === 'string' && raw.CommandLine ? raw.CommandLine : null,
      }];
    });
  } catch {
    return [];
  }
}

function windowsExecutableName(processName: string): string {
  return processName.toLowerCase().endsWith('.exe') ? processName : `${processName}.exe`;
}

function windowsCommandStartsWithExecutable(commandLine: string, executable: string): boolean {
  const command = commandLine.trim().toLowerCase();
  const candidate = path.win32.normalize(executable).toLowerCase();
  const quotedCandidate = `"${candidate}"`;
  if (command.startsWith(quotedCandidate)) {
    const next = command.charAt(quotedCandidate.length);
    return next === '' || /\s/.test(next);
  }
  if (!command.startsWith(candidate)) return false;
  const next = command.charAt(candidate.length);
  return next === '' || /\s/.test(next);
}

function findWindowsProcesses(processName: string): WindowsProcessRow[] {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      windowsProcessQuery(windowsExecutableName(processName)),
    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 });
    return parseWindowsProcessOutput(output);
  } catch {
    return [];
  }
}

function taskkill(pid: number, force: boolean): void {
  try {
    execFileSync('taskkill.exe', [
      '/PID',
      String(pid),
      '/T',
      ...(force ? ['/F'] : []),
    ], { stdio: 'pipe', timeout: 5_000 });
  } catch {
    // Process may have already exited or rejected a graceful close.
  }
}

/**
 * Probe an HTTP(S) CDP endpoint.
 * When expectedHosts is provided, at least one page target must belong to that app.
 */
export function probeCDPEndpoint(
  endpoint: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  expectedHosts: readonly string[] = [],
): Promise<boolean> {
  let target: URL;
  try {
    target = new URL(endpoint);
    target.pathname = `${target.pathname.replace(/\/$/, '')}/json`;
    target.search = '';
    target.hash = '';
  } catch {
    return Promise.resolve(false);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(
      target,
      { method: 'GET', timeout: timeoutMs },
      (res) => {
        const success = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300;
        if (!success) {
          res.resume();
          finish(false);
          return;
        }
        if (expectedHosts.length === 0) {
          res.resume();
          finish(true);
          return;
        }

        res.setEncoding('utf-8');
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
          if (body.length > MAX_CDP_RESPONSE_BYTES) {
            req.destroy();
            finish(false);
          }
        });
        res.on('error', () => finish(false));
        res.on('end', () => finish(cdpTargetsMatchHosts(body, expectedHosts)));
      },
    );
    req.on('error', () => finish(false));
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.end();
  });
}

/** Probe a loopback CDP endpoint by port. */
export function probeCDP(
  port: number,
  timeoutMs: number = PROBE_TIMEOUT_MS,
  expectedHosts: readonly string[] = [],
): Promise<boolean> {
  return probeCDPEndpoint(`http://127.0.0.1:${port}`, timeoutMs, expectedHosts);
}

/**
 * Check if a process with the given name is running.
 * Uses pgrep on macOS/Linux.
 */
export function detectProcess(processName: string): boolean {
  if (process.platform === 'win32') return false; // pgrep not available on Windows
  return findProcessPids(processName).length > 0;
}

function findProcessPids(processName: string): number[] {
  try {
    const output = execFileSync('pgrep', ['-x', processName], { encoding: 'utf-8', stdio: 'pipe' });
    return parsePgrepOutput(output);
  } catch {
    return [];
  }
}

function readProcessCommand(pid: number): string | null {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return null;
  }
}

function commandStartsWithExecutable(command: string, executable: string): boolean {
  if (!command.startsWith(executable)) return false;
  const next = command.charAt(executable.length);
  return next === '' || /\s/.test(next);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Kill a process by name. Sends SIGTERM first, then SIGKILL after grace period.
 */
export async function killProcess(processName: string): Promise<void> {
  if (process.platform === 'win32') return; // pkill not available on Windows
  try {
    execFileSync('pkill', ['-x', processName], { stdio: 'pipe' });
  } catch {
    // Process may have already exited
  }

  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    if (!detectProcess(processName)) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    execFileSync('pkill', ['-9', '-x', processName], { stdio: 'pipe' });
  } catch {
    // Ignore
  }
}

/** Discover the app installation path supported by the current platform. */
export function discoverAppPath(displayName: string, bundleId?: string): string | null {
  return discoverAppPathForEntry({ displayName, bundleId, processName: displayName });
}

function normalizeAppPath(appPath: string): string {
  return appPath.trim().replace(/[\\/]+$/, '');
}

function getEnvironmentValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const matched = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase());
  return matched ? env[matched] : undefined;
}

function expandWindowsEnvironment(value: string, env: NodeJS.ProcessEnv): string | null {
  const expanded = value.replace(/%([^%]+)%/g, (match, name: string) => getEnvironmentValue(env, name) ?? match);
  return /%[^%]+%/.test(expanded) ? null : normalizeAppPath(expanded);
}

function uniquePaths(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function windowsInstallRoots(app: ElectronAppPathEntry, env: NodeJS.ProcessEnv): string[] {
  const roots = (app.windowsInstallDirs ?? [])
    .map((value) => expandWindowsEnvironment(value, env))
    .filter((value): value is string => Boolean(value));
  const labels = [...new Set([app.displayName, app.processName].filter((value): value is string => Boolean(value)))];
  const localAppData = getEnvironmentValue(env, 'LOCALAPPDATA');
  const programFiles = getEnvironmentValue(env, 'ProgramFiles');
  const programFilesX86 = getEnvironmentValue(env, 'ProgramFiles(x86)');

  for (const label of labels) {
    if (localAppData) {
      roots.push(path.join(localAppData, label));
      roots.push(path.join(localAppData, 'Programs', label));
    }
    if (programFiles) roots.push(path.join(programFiles, label));
    if (programFilesX86) roots.push(path.join(programFilesX86, label));
  }
  return uniquePaths(roots.map(normalizeAppPath));
}

function windowsExecutableNames(app: ElectronAppPathEntry): string[] {
  const names = app.executableNames?.length ? app.executableNames : [app.processName];
  return [...new Set(names.map(windowsExecutableName))];
}

function findWindowsExecutable(root: string, executableNames: readonly string[]): string | null {
  for (const name of executableNames) {
    const direct = path.join(root, name);
    if (fs.existsSync(direct)) return direct;
  }

  try {
    const appDirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^app-/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true, sensitivity: 'base' }));
    for (const appDir of appDirs) {
      for (const name of executableNames) {
        const candidate = path.join(root, appDir, name);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {
    // Missing or unreadable install root.
  }
  return null;
}

export function discoverWindowsAppPath(app: ElectronAppPathEntry, env: NodeJS.ProcessEnv = process.env): string | null {
  const executableNames = windowsExecutableNames(app);
  for (const root of windowsInstallRoots(app, env)) {
    const executable = findWindowsExecutable(root, executableNames);
    if (executable) return path.dirname(executable);
  }
  return null;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function discoverAppPathByOsascript(nameOrBundleId: string, kind: 'name' | 'id'): string | null {
  try {
    const appSpecifier = kind === 'id'
      ? `id "${appleScriptString(nameOrBundleId)}"`
      : `"${appleScriptString(nameOrBundleId)}"`;
    const result = execFileSync('osascript', [
      '-e', `POSIX path of (path to application ${appSpecifier})`,
    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 });
    const appPath = normalizeAppPath(result);
    return appPath ? appPath : null;
  } catch {
    return null;
  }
}

function discoverAppPathByBundleId(bundleId: string): string | null {
  if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) return null;
  try {
    const result = execFileSync('mdfind', [
      `kMDItemCFBundleIdentifier == "${bundleId}"`,
    ], { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 });
    const appPath = result
      .split(/\r?\n/)
      .map((line) => normalizeAppPath(line))
      .find((line) => line.endsWith('.app'));
    return appPath ?? null;
  } catch {
    return null;
  }
}

function discoverAppPathForEntry(app: ElectronAppPathEntry): string | null {
  if (process.platform === 'win32') return discoverWindowsAppPath(app);
  if (process.platform !== 'darwin') return null;

  if (app.bundleId) {
    const byBundleId = discoverAppPathByOsascript(app.bundleId, 'id') ?? discoverAppPathByBundleId(app.bundleId);
    if (byBundleId) return byBundleId;
  }

  const label = app.displayName ?? app.processName;
  return label ? discoverAppPathByOsascript(label, 'name') : null;
}

function resolveExecutable(appPath: string, processName: string): string {
  if (process.platform === 'win32' && !appPath.toLowerCase().endsWith('.app')) {
    return path.join(appPath, windowsExecutableName(processName));
  }
  return `${appPath}/Contents/MacOS/${processName}`;
}

function resolveAppPathAliases(appPath: string): string[] {
  const normalizedPath = normalizeAppPath(appPath);
  const aliases = [normalizedPath];
  try {
    const realPath = normalizeAppPath(fs.realpathSync(normalizedPath));
    if (realPath && !aliases.includes(realPath)) aliases.push(realPath);
  } catch {
    // If realpath is unavailable, the original app path is still the best evidence.
  }
  return aliases;
}

function isMissingExecutableError(err: unknown, label: string): boolean {
  return err instanceof CommandExecutionError
    && err.message.startsWith(`Could not launch ${label}: executable not found at `);
}

export function resolveExecutableCandidates(appPath: string, app: ElectronAppEntry): string[] {
  const executableNames = app.executableNames?.length ? app.executableNames : [app.processName];
  const appPaths = resolveAppPathAliases(appPath);
  const candidates = [];
  for (const name of new Set(executableNames)) {
    for (const candidateAppPath of appPaths) {
      candidates.push(resolveExecutable(candidateAppPath, name));
    }
  }
  return candidates;
}

export function findAppProcessPids(appPath: string, app: ElectronAppEntry): number[] {
  const executables = resolveExecutableCandidates(appPath, app);
  const candidatesByName = new Map<string, string[]>();
  for (const executable of executables) {
    const name = path.basename(executable);
    candidatesByName.set(name, [...(candidatesByName.get(name) ?? []), executable]);
  }

  const matched = new Set<number>();
  if (process.platform === 'win32') {
    for (const [processName, candidates] of candidatesByName) {
      const normalizedCandidates = new Set(candidates.map((candidate) => path.win32.normalize(candidate).toLowerCase()));
      for (const row of findWindowsProcesses(processName)) {
        if (row.executablePath && normalizedCandidates.has(path.win32.normalize(row.executablePath).toLowerCase())) {
          matched.add(row.pid);
          continue;
        }
        const commandLine = row.commandLine;
        if (commandLine) {
          if (candidates.some((candidate) => windowsCommandStartsWithExecutable(commandLine, candidate))) {
            matched.add(row.pid);
          }
        }
      }
    }
    return [...matched];
  }

  for (const [processName, candidates] of candidatesByName) {
    for (const pid of findProcessPids(processName)) {
      const command = readProcessCommand(pid);
      if (command && candidates.some((candidate) => commandStartsWithExecutable(command, candidate))) {
        matched.add(pid);
      }
    }
  }

  return [...matched];
}

export function detectAppProcess(appPath: string, app: ElectronAppEntry): boolean {
  return findAppProcessPids(appPath, app).length > 0;
}

export async function killAppProcess(appPath: string, app: ElectronAppEntry): Promise<void> {
  if (process.platform === 'win32') {
    for (const pid of findAppProcessPids(appPath, app)) taskkill(pid, false);

    const deadline = Date.now() + KILL_GRACE_MS;
    while (Date.now() < deadline) {
      if (findAppProcessPids(appPath, app).length === 0) return;
      await new Promise((r) => setTimeout(r, 200));
    }

    for (const pid of findAppProcessPids(appPath, app)) taskkill(pid, true);
    return;
  }

  for (const pid of findAppProcessPids(appPath, app)) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process may have already exited.
    }
  }

  const deadline = Date.now() + KILL_GRACE_MS;
  while (Date.now() < deadline) {
    const livePids = findAppProcessPids(appPath, app).filter(processIsAlive);
    if (livePids.length === 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  for (const pid of findAppProcessPids(appPath, app)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Ignore.
    }
  }
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

export async function launchElectronApp(appPath: string, app: ElectronAppEntry, args: string[], label: string): Promise<void> {
  const executables = resolveExecutableCandidates(appPath, app);
  let lastMissingExecutableError: CommandExecutionError | undefined;

  for (const executable of executables) {
    log.debug(`[launcher] Launching: ${executable} ${args.join(' ')}`);
    try {
      await launchDetachedApp(executable, args, label);
      return;
    } catch (err) {
      if (isMissingExecutableError(err, label)) {
        lastMissingExecutableError = err as CommandExecutionError;
        continue;
      }
      throw err;
    }
  }

  if (executables.length > 1) {
    const location = process.platform === 'win32' && !appPath.toLowerCase().endsWith('.app')
      ? appPath
      : path.join(appPath, 'Contents', 'MacOS');
    throw new CommandExecutionError(
      `Could not launch ${label}: no compatible executable found in ${location}`,
      `Tried: ${executables.map((executable) => path.basename(executable)).join(', ')}. Install ${label}, reinstall it, or register a custom app path in ~/.opencli/apps.yaml`,
    );
  }

  throw lastMissingExecutableError ?? new CommandExecutionError(
    `Could not launch ${label}`,
    `Install ${label}, reinstall it, or register a custom app path in ~/.opencli/apps.yaml`,
  );
}

export function electronLaunchArgs(port: number, extraArgs: string[] = []): string[] {
  return [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    ...extraArgs,
  ];
}

function manualElectronLaunchHint(label: string, port: number): string {
  return `Start ${label} manually with --remote-debugging-port=${port} --remote-allow-origins=*, then either:`;
}

async function pollForReady(port: number, expectedHosts: readonly string[] = []): Promise<void> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await probeCDP(port, 1_000, expectedHosts)) return;
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
  if (await probeCDP(port, PROBE_TIMEOUT_MS, app.cdpHosts)) {
    log.debug(`[launcher] CDP already available on port ${port}`);
    return endpoint;
  }

  if (app.cdpHosts?.length && await probeCDP(port)) {
    throw new CommandExecutionError(
      `CDP port ${port} is active but does not belong to ${label}.`,
      `Close the conflicting process on 127.0.0.1:${port}, or configure a different port for ${label}.`,
    );
  }

  // Step 2: Running without CDP? Auto-launch currently supports macOS and Windows.
  if (process.platform !== 'darwin' && process.platform !== 'win32') {
    throw new CommandExecutionError(
      `${label} is not reachable on CDP port ${port}.`,
      `Auto-launch is not yet supported on ${process.platform}.\n` +
      `${manualElectronLaunchHint(label, port)}\n` +
      `  • Set OPENCLI_CDP_ENDPOINT=http://127.0.0.1:${port}\n` +
      `  • Or just re-run the command once ${label} is listening on port ${port}.`,
    );
  }

  // Step 3: Discover path
  const appPath = discoverAppPathForEntry(app);
  if (!appPath) {
    throw new CommandExecutionError(
      `Could not find ${label} on this machine.`,
      `Install ${label} or register a custom path in ~/.opencli/apps.yaml`,
    );
  }

  const isRunning = detectAppProcess(appPath, app);
  if (isRunning) {
    log.debug(`[launcher] ${label} is running but CDP not available`);
    const confirmed = await confirmPrompt(
      `${label} is running but CDP is not enabled. Restart with debug port?`,
      false,
    );
    if (!confirmed) {
      throw new CommandExecutionError(
        `${label} needs to be restarted with CDP enabled.`,
        `Manually restart: kill the app and relaunch with --remote-debugging-port=${port} --remote-allow-origins=*`,
      );
    }
    process.stderr.write(`  Restarting ${label}...\n`);
    await killAppProcess(appPath, app);
  }

  // Step 4: Launch
  //
  // Chrome / Electron 142+ enforces an Origin allow-list on the CDP
  // WebSocket upgrade (ws://127.0.0.1:<port>/devtools/page/<id>). Without
  // --remote-allow-origins=* every ws client other than chrome://inspect
  // gets HTTP 403 "Rejected an incoming WebSocket connection from the
  // http://127.0.0.1:<port> origin". This affects every Electron app
  // opencli launches because they all bundle a recent Chromium. Same
  // mitigation as Puppeteer / Playwright / chrome-devtools-mcp.
  const args = electronLaunchArgs(port, app.extraArgs ?? []);
  await launchElectronApp(appPath, app, args, label);

  // Step 5: Poll for readiness
  process.stderr.write(`  Waiting for ${label} on port ${port}...\n`);
  await pollForReady(port, app.cdpHosts);
  process.stderr.write(`  Connected to ${label} on port ${port}.\n`);

  return endpoint;
}
