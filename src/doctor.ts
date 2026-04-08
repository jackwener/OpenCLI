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

const DOCTOR_LIVE_TIMEOUT_SECONDS = 8;

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
  daemonFlaky?: boolean;
  extensionConnected: boolean;
  extensionFlaky?: boolean;
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
    const page = await bridge.connect({ timeout: opts?.timeout ?? DOCTOR_LIVE_TIMEOUT_SECONDS });
    // Try a simple eval to verify end-to-end connectivity
    await page.evaluate('1 + 1');
    await bridge.close();
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err), durationMs: Date.now() - start };
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Try to auto-start daemon if it's not running, so we show accurate status.
  let initialStatus = await checkDaemonStatus();
  if (!initialStatus.running) {
    try {
      const bridge = new BrowserBridge();
      await bridge.connect({ timeout: 5 });
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
  }

  const status = await checkDaemonStatus();
  const daemonFlaky = !!(connectivity?.ok && !status.running);
  const extensionFlaky = !!(connectivity?.ok && status.running && !status.extensionConnected);
  const daemonRunning = status.running;
  const extensionConnected = status.extensionConnected;
  const sessions = opts.sessions && status.running && status.extensionConnected
    ? await listSessions() as Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>
    : undefined;

  const issues: string[] = [];
  if (daemonFlaky) {
    issues.push(
      'Daemon connectivity is unstable. The live browser test succeeded, but the daemon was no longer running immediately afterward.\n' +
      'This usually means the daemon crashed or exited right after serving the live probe.',
    );
  } else if (!daemonRunning) {
    issues.push('Daemon is not running. It should start automatically when you run an opencli browser command.');
  }
  if (extensionFlaky) {
    issues.push(
      'Extension connection is unstable. The live browser test succeeded, but the daemon reported the extension disconnected immediately afterward.\n' +
      'This usually means the Browser Bridge service worker is reconnecting slowly or Chrome suspended it.',
    );
  } else if (daemonRunning && !extensionConnected) {
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
    daemonRunning,
    daemonFlaky,
    extensionConnected,
    extensionFlaky,
    extensionVersion: status.extensionVersion,
    connectivity,
    sessions,
    issues,
  };
}

export function renderBrowserDoctorReport(report: DoctorReport): string {
  const lines = [chalk.bold(`opencli v${report.cliVersion ?? 'unknown'} doctor`) + chalk.dim(` (${getRuntimeLabel()})`), ''];

  // Daemon status
  const daemonIcon = report.daemonFlaky
    ? chalk.yellow('[WARN]')
    : report.daemonRunning ? chalk.green('[OK]') : chalk.red('[MISSING]');
  const daemonLabel = report.daemonFlaky
    ? 'unstable (running during live check, then stopped)'
    : report.daemonRunning ? `running on port ${DEFAULT_DAEMON_PORT}` : 'not running';
  lines.push(`${daemonIcon} Daemon: ${daemonLabel}`);

  // Extension status
  const extIcon = report.extensionFlaky
    ? chalk.yellow('[WARN]')
    : report.extensionConnected ? chalk.green('[OK]') : chalk.yellow('[MISSING]');
  const extVersion = report.extensionVersion ? chalk.dim(` (v${report.extensionVersion})`) : '';
  const extLabel = report.extensionFlaky
    ? 'unstable (connected during live check, then disconnected)'
    : report.extensionConnected ? 'connected' : 'not connected';
  lines.push(`${extIcon} Extension: ${extLabel}${extVersion}`);

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
