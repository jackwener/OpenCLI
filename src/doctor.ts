/**
 * opencli doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */

import chalk from 'chalk';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { checkDaemonStatus } from './browser/discover.js';
import { BrowserBridge } from './browser/index.js';
import { listSessions } from './browser/daemon-client.js';
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
  browserName?: string;
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
    return { ok: true, durationMs: Date.now() - start, browserName: bridge.inferredBrowserName ?? undefined };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err), durationMs: Date.now() - start };
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Try to auto-start daemon if it's not running, so we show accurate status.
  let initialStatus = await checkDaemonStatus();
  let inferredBrowserName: string | undefined;
  if (!initialStatus.running) {
    try {
      const bridge = new BrowserBridge();
      await bridge.connect({ timeout: 5 });
      inferredBrowserName = bridge.inferredBrowserName ?? undefined;
      await bridge.close();
    } catch {
      // Auto-start failed; we'll report it below.
    }
  }

  // Run the live connectivity check — it may also auto-start the daemon as a
  // side-effect, so we read daemon status only *after* all side-effects settle.
  let connectivity: ConnectivityResult | undefined;
  if (opts.live) {
    connectivity = await checkConnectivity();
    if (connectivity.ok && !connectivity.browserName && inferredBrowserName) {
      connectivity.browserName = inferredBrowserName;
    }
  }

  const status = await checkDaemonStatus();
  const sessions = opts.sessions && status.running && status.extensionConnected
    ? await listSessions() as Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>
    : undefined;

  const issues: string[] = [];
  if (!status.running) {
    issues.push('Daemon is not running. It should start automatically when you run an opencli browser command.');
  }
  if (status.running && !status.extensionConnected) {
    issues.push(
      'Daemon is running but the Browser Bridge extension is not connected.\n' +
      'Please install the opencli Browser Bridge extension:\n' +
      '  1. Download from https://github.com/jackwener/opencli/releases\n' +
      '  2. In a Chromium-based browser, open the extensions page:\n' +
      '     - Chrome: chrome://extensions\n' +
      '     - Edge: edge://extensions\n' +
      '  3. Enable Developer Mode → Click "Load unpacked" → select the extension folder',
    );
  }
  if (connectivity && !connectivity.ok) {
    issues.push(`Browser connectivity test failed: ${connectivity.error ?? 'unknown'}`);
  }
  if (status.extensionVersion && opts.cliVersion) {
    const extMajor = status.extensionVersion.split('.')[0];
    const cliMajor = opts.cliVersion.split('.')[0];
    if (extMajor !== cliMajor) {
      issues.push(
        `Extension major version mismatch: extension v${status.extensionVersion} ≠ CLI v${opts.cliVersion}\n` +
        '  Download the latest extension from: https://github.com/jackwener/opencli/releases',
      );
    }
  }

  return {
    cliVersion: opts.cliVersion,
    daemonRunning: status.running,
    extensionConnected: status.extensionConnected,
    extensionVersion: status.extensionVersion,
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
    if (report.connectivity.ok && report.connectivity.browserName) {
      lines.push(`${chalk.green('[OK]')} Browser: ${report.connectivity.browserName} (inferred from this run)`);
    }
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
