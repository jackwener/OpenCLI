/**
 * opencli doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */

import chalk from 'chalk';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { getDaemonHealth, listSessions } from './browser/daemon-client.js';
import { BrowserBridge } from './browser/index.js';
import { getErrorMessage } from './errors.js';
import { getRuntimeLabel } from './runtime-detect.js';

export type DoctorOptions = {
  yes?: boolean;
  live?: boolean;
  sessions?: boolean;
  cliVersion?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  error?: string;
  durationMs: number;
};


export type DoctorReport = {
  cliVersion?: string;
  daemonRunning: boolean;
  extensionConnected: boolean;
  extensionVersion?: string;
  connectivity?: ConnectivityResult;
  sessions?: Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>;
  issues: string[];
};

/**
 * Test connectivity by attempting a real browser command.
 */
export async function checkConnectivity(opts?: { timeout?: number }): Promise<ConnectivityResult> {
  const start = Date.now();
  try {
    const bridge = new BrowserBridge();
    const page = await bridge.connect({ timeout: opts?.timeout ?? 8 });
    // Try a simple eval to verify end-to-end connectivity
    await page.evaluate('1 + 1');
    await bridge.close();
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err), durationMs: Date.now() - start };
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Live connectivity test — bridge.connect() auto-starts the daemon if needed,
  // so we don't duplicate auto-start logic here.
  let connectivity: ConnectivityResult | undefined;
  if (opts.live) {
    connectivity = await checkConnectivity();
  }

  // Single status check *after* any side-effects from the live test have settled.
  const health = await getDaemonHealth();
  const running = health.state !== 'stopped';
  const extensionConnected = health.state === 'ready';
  const extensionVersion = health.status?.extensionVersion;

  const sessions = opts.sessions && extensionConnected
    ? await listSessions() as Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>
    : undefined;

  const issues: string[] = [];
  if (!running) {
    issues.push('Daemon is not running. It should start automatically when you run an opencli browser command.');
  }
  if (health.state === 'no-extension') {
    issues.push(
      'Daemon is running but the Chrome/Chromium extension is not connected.\n' +
      'Please install the opencli Browser Bridge extension:\n' +
      '  1. Download from https://github.com/jackwener/opencli/releases\n' +
      '  2. Open chrome://extensions/ → Enable Developer Mode\n' +
      '  3. Click "Load unpacked" → select the extension folder',
    );
  }
  if (connectivity && !connectivity.ok) {
    issues.push(`Browser connectivity test failed: ${connectivity.error ?? 'unknown'}`);
  }
  if (extensionVersion && opts.cliVersion) {
    const extMajor = extensionVersion.split('.')[0];
    const cliMajor = opts.cliVersion.split('.')[0];
    if (extMajor !== cliMajor) {
      issues.push(
        `Extension major version mismatch: extension v${extensionVersion} ≠ CLI v${opts.cliVersion}\n` +
        '  Download the latest extension from: https://github.com/jackwener/opencli/releases',
      );
    }
  }

  return {
    cliVersion: opts.cliVersion,
    daemonRunning: running,
    extensionConnected,
    extensionVersion,
    connectivity,
    sessions,
    issues,
  };
}

export function renderBrowserDoctorReport(report: DoctorReport): string {
  const lines = [chalk.bold(`opencli v${report.cliVersion ?? 'unknown'} doctor`) + chalk.dim(` (${getRuntimeLabel()})`), ''];

  // Daemon status
  const daemonIcon = report.daemonRunning ? chalk.green('[OK]') : chalk.red('[MISSING]');
  lines.push(`${daemonIcon} Daemon: ${report.daemonRunning ? `running on port ${DEFAULT_DAEMON_PORT}` : 'not running'}`);

  // Extension status
  const extIcon = report.extensionConnected ? chalk.green('[OK]') : chalk.yellow('[MISSING]');
  const extVersion = report.extensionVersion ? chalk.dim(` (v${report.extensionVersion})`) : '';
  lines.push(`${extIcon} Extension: ${report.extensionConnected ? 'connected' : 'not connected'}${extVersion}`);

  // Connectivity
  if (report.connectivity) {
    const connIcon = report.connectivity.ok ? chalk.green('[OK]') : chalk.red('[FAIL]');
    const detail = report.connectivity.ok
      ? `connected in ${(report.connectivity.durationMs / 1000).toFixed(1)}s`
      : `failed (${report.connectivity.error ?? 'unknown'})`;
    lines.push(`${connIcon} Connectivity: ${detail}`);
  } else {
    lines.push(`${chalk.dim('[SKIP]')} Connectivity: skipped (--no-live)`);
  }

  if (report.sessions) {
    lines.push('', chalk.bold('Sessions:'));
    if (report.sessions.length === 0) {
      lines.push(chalk.dim('  • no active automation sessions'));
    } else {
      for (const session of report.sessions) {
        lines.push(chalk.dim(`  • ${session.workspace} → window ${session.windowId}, tabs=${session.tabCount}, idle=${Math.ceil(session.idleMsRemaining / 1000)}s`));
      }
    }
  }

  if (report.issues.length) {
    lines.push('', chalk.yellow('Issues:'));
    for (const issue of report.issues) {
      lines.push(chalk.dim(`  • ${issue}`));
    }
  } else if (report.daemonRunning && report.extensionConnected) {
    lines.push('', chalk.green('Everything looks good!'));
  }

  return lines.join('\n');
}
