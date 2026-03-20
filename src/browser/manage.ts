import chalk from 'chalk';
import { isProcessAlive, readLaunchRegistry, type BrowserLaunchRegistryEntry } from './instances.js';

export interface StopBrowsersOptions {
  port?: number;
  pid?: number;
  all?: boolean;
  timeoutMs?: number;
}

export interface StopBrowsersReport {
  stopped: Array<{ pid: number; port?: number }>;
  issues: string[];
}

type StopTarget = { pid: number; port?: number };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true;
    await wait(100);
  }
  return !isProcessAlive(pid);
}

function validateStopOptions(opts: StopBrowsersOptions): void {
  const specifiedTargets = [
    opts.port !== undefined,
    opts.pid !== undefined,
    Boolean(opts.all),
  ].filter(Boolean).length;

  if (specifiedTargets !== 1) {
    throw new Error('Choose exactly one stop target: --port <port>, --pid <pid>, or --all');
  }
}

async function stopPid(pid: number, timeoutMs: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  process.kill(pid, 'SIGTERM');
  return waitForProcessExit(pid, timeoutMs);
}

function resolveStopTargets(
  opts: StopBrowsersOptions,
  registryEntries: BrowserLaunchRegistryEntry[],
  issues: string[],
): StopTarget[] {
  if (opts.all) {
    const targets = registryEntries
      .filter((entry) => isProcessAlive(entry.pid))
      .map((entry) => ({ pid: entry.pid, port: entry.port }));

    if (targets.length === 0) {
      issues.push('No running opencli-managed browsers found.');
    }

    return targets;
  }

  if (opts.port !== undefined) {
    const entry = registryEntries.find((item) => item.port === opts.port);
    if (!entry) {
      issues.push(`No opencli-managed browser found for port ${opts.port}.`);
      return [];
    }
    if (!isProcessAlive(entry.pid)) {
      issues.push(`Browser on port ${opts.port} is not running.`);
      return [];
    }
    return [{ pid: entry.pid, port: entry.port }];
  }

  if (opts.pid === undefined) return [];
  if (!isProcessAlive(opts.pid)) {
    issues.push(`Process ${opts.pid} is not running.`);
    return [];
  }

  return [{ pid: opts.pid, port: registryEntries.find((item) => item.pid === opts.pid)?.port }];
}

export async function stopBrowsers(opts: StopBrowsersOptions): Promise<StopBrowsersReport> {
  validateStopOptions(opts);

  const timeoutMs = opts.timeoutMs ?? 5_000;
  const registryEntries = await readLaunchRegistry();
  const issues: string[] = [];
  const stopped: StopBrowsersReport['stopped'] = [];
  const targets = resolveStopTargets(opts, registryEntries, issues);

  for (const target of targets) {
    try {
      const exited = await stopPid(target.pid, timeoutMs);
      if (!exited) {
        issues.push(`Timed out waiting for pid ${target.pid} to exit.`);
        continue;
      }
      stopped.push(target);
    } catch (err: any) {
      issues.push(`Failed to stop pid ${target.pid}: ${err?.message ?? String(err)}`);
    }
  }

  return { stopped, issues };
}

export function renderStopBrowsersReport(report: StopBrowsersReport): string {
  const lines = [chalk.bold('opencli browser stop'), ''];

  if (report.stopped.length > 0) {
    lines.push(chalk.green(`Stopped ${report.stopped.length} browser process(es).`));
    for (const item of report.stopped) {
      lines.push(chalk.dim(`  - pid=${item.pid}${item.port ? `, port=${item.port}` : ''}`));
    }
  } else {
    lines.push(chalk.dim('No browser processes stopped.'));
  }

  if (report.issues.length > 0) {
    lines.push('', chalk.yellow('Issues:'));
    for (const issue of report.issues) {
      lines.push(chalk.dim(`  - ${issue}`));
    }
  }

  return lines.join('\n');
}
