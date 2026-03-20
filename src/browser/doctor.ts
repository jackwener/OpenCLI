import chalk from 'chalk';
import { browserSession } from '../runtime.js';
import { getBrowserFactory, resolveBrowserBackend, type BrowserMode, type ResolvedBrowserMode } from './backend.js';
import { checkDaemonStatus } from './discover.js';
import { listSessions } from './daemon-client.js';
import { listDebugBrowsers, summarizeDebugBrowsers, type DebugBrowserInstance } from './instances.js';

export type BrowserDoctorOptions = {
  backend?: string;
  live?: boolean;
  sessions?: boolean;
  cliVersion?: string;
};

export type ConnectivityResult = {
  ok: boolean;
  error?: string;
  durationMs: number;
};

export type BrowserDoctorReport = {
  cliVersion?: string;
  requestedBackend: BrowserMode;
  backend: ResolvedBrowserMode;
  cdpEndpoint?: string;
  cdpTarget?: string;
  discoveredDebugBrowsers: DebugBrowserInstance[];
  daemonRunning?: boolean;
  extensionConnected?: boolean;
  connectivity?: ConnectivityResult;
  sessions?: Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>;
  issues: string[];
};

export async function checkBrowserBackendConnectivity(rawBackend?: string): Promise<ConnectivityResult> {
  const start = Date.now();
  try {
    const BrowserFactory = getBrowserFactory(rawBackend);
    await browserSession(BrowserFactory, async (page) => {
      await page.evaluate('1 + 1');
    }, { workspace: `doctor:${rawBackend ?? 'auto'}` });
    return { ok: true, durationMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err), durationMs: Date.now() - start };
  }
}

export async function runBrowserBackendDoctor(opts: BrowserDoctorOptions = {}): Promise<BrowserDoctorReport> {
  const resolved = resolveBrowserBackend(opts.backend);
  const issues: string[] = [];
  const discoveredDebugBrowsers = await listDebugBrowsers();

  let daemonRunning: boolean | undefined;
  let extensionConnected: boolean | undefined;
  let sessions: BrowserDoctorReport['sessions'];

  if (resolved.mode === 'extension') {
    const status = await checkDaemonStatus();
    daemonRunning = status.running;
    extensionConnected = status.extensionConnected;

    if (!status.running) {
      issues.push('Daemon is not running. It should start automatically when you run an opencli browser command.');
    }
    if (status.running && !status.extensionConnected) {
      issues.push(
        'Daemon is running but the Chrome extension is not connected.\n' +
        'Please install and enable the opencli Browser Bridge extension:\n' +
        '  1. Download from GitHub Releases\n' +
        '  2. Open chrome://extensions/ → Enable Developer Mode\n' +
        '  3. Click "Load unpacked" → select the extension folder',
      );
    }

    if (opts.sessions && status.running && status.extensionConnected) {
      sessions = await listSessions() as Array<{ workspace: string; windowId: number; tabCount: number; idleMsRemaining: number }>;
    }
  } else if (!resolved.cdpEndpoint) {
    issues.push(
      'CDP endpoint is not configured. Start one with `opencli browser launch --port 9222` or pass `--cdp-endpoint <url>`.',
    );
  }

  let connectivity: ConnectivityResult | undefined;
  if (opts.live && (resolved.mode === 'extension' || resolved.cdpEndpoint)) {
    connectivity = await checkBrowserBackendConnectivity(resolved.mode);
    if (!connectivity.ok) {
      issues.push(`Browser connectivity test failed: ${connectivity.error ?? 'unknown'}`);
    }
  }

  return {
    cliVersion: opts.cliVersion,
    requestedBackend: resolved.requestedMode,
    backend: resolved.mode,
    cdpEndpoint: resolved.cdpEndpoint,
    cdpTarget: resolved.cdpTarget,
    discoveredDebugBrowsers,
    daemonRunning,
    extensionConnected,
    connectivity,
    sessions,
    issues,
  };
}

export function renderBrowserBackendDoctorReport(report: BrowserDoctorReport): string {
  const lines = [chalk.bold(`opencli v${report.cliVersion ?? 'unknown'} browser doctor`), ''];

  lines.push(`${chalk.cyan('[INFO]')} Requested backend: ${report.requestedBackend}`);
  lines.push(`${chalk.green('[OK]')} Effective backend: ${report.backend}`);
  lines.push(`${chalk.cyan('[INFO]')} Local CDP browsers: ${summarizeDebugBrowsers(report.discoveredDebugBrowsers)}`);

  if (report.backend === 'extension') {
    const daemonIcon = report.daemonRunning ? chalk.green('[OK]') : chalk.red('[MISSING]');
    const extIcon = report.extensionConnected ? chalk.green('[OK]') : chalk.yellow('[MISSING]');
    lines.push(`${daemonIcon} Daemon: ${report.daemonRunning ? 'running on port 19825' : 'not running'}`);
    lines.push(`${extIcon} Extension: ${report.extensionConnected ? 'connected' : 'not connected'}`);
  } else {
    const endpointIcon = report.cdpEndpoint ? chalk.green('[OK]') : chalk.red('[MISSING]');
    lines.push(`${endpointIcon} CDP endpoint: ${report.cdpEndpoint ?? 'not configured'}`);
    if (report.cdpTarget) {
      lines.push(`${chalk.cyan('[INFO]')} CDP target: ${report.cdpTarget}`);
    }
  }

  if (report.connectivity) {
    const connIcon = report.connectivity.ok ? chalk.green('[OK]') : chalk.red('[FAIL]');
    const detail = report.connectivity.ok
      ? `connected in ${(report.connectivity.durationMs / 1000).toFixed(1)}s`
      : `failed (${report.connectivity.error ?? 'unknown'})`;
    lines.push(`${connIcon} Connectivity: ${detail}`);
  } else {
    lines.push(`${chalk.dim('[SKIP]')} Connectivity: not tested (use --live)`);
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
  } else {
    lines.push('', chalk.green('Everything looks good!'));
  }

  return lines.join('\n');
}
