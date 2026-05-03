/**
 * opencli doctor — diagnose browser connectivity.
 *
 * Simplified for the daemon-based architecture.
 */

import { styleText } from 'node:util';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { BrowserBridge } from './browser/index.js';
import { getDaemonHealth, listSessions } from './browser/daemon-client.js';
import { getErrorMessage } from './errors.js';
import { getRuntimeLabel } from './runtime-detect.js';
import { getCachedLatestExtensionVersion } from './update-check.js';
import type { BrowserSessionInfo } from './types.js';
import type { BrowserProfileStatus } from './browser/daemon-client.js';
import { aliasForContextId, loadProfileConfig } from './browser/profile.js';
import { formatDaemonVersion, isDaemonStale, staleDaemonIssue } from './browser/daemon-version.js';

const DOCTOR_LIVE_TIMEOUT_SECONDS = 8;

/** Parse a semver string into [major, minor, patch]. Returns null on invalid input. */
function parseSemver(v: string): [number, number, number] | null {
  const parts = v.replace(/^v/, '').split('-')[0].split('.').map(Number);
  if (parts.length < 3 || parts.some(isNaN)) return null;
  return [parts[0], parts[1], parts[2]];
}

/** Returns true if `a` is strictly newer than `b`. */
function isNewerVersion(a: string, b: string): boolean {
  const va = parseSemver(a);
  const vb = parseSemver(b);
  if (!va || !vb) return false;
  const cmp = va[0] - vb[0] || va[1] - vb[1] || va[2] - vb[2];
  return cmp > 0;
}

/** Check if version satisfies a simple range like ">=1.7.0". */
function satisfiesRange(version: string, range: string): boolean {
  const match = range.match(/^(>=?)\s*(\S+)$/);
  if (!match) return true; // Unknown range format — don't block
  const [, op, rangeVer] = match;
  const v = parseSemver(version);
  const r = parseSemver(rangeVer);
  if (!v || !r) return true;
  const cmp = v[0] - r[0] || v[1] - r[1] || v[2] - r[2];
  return op === '>=' ? cmp >= 0 : cmp > 0;
}

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
  daemonStale?: boolean;
  daemonVersion?: string;
  extensionConnected: boolean;
  extensionFlaky?: boolean;
  extensionVersion?: string;
  latestExtensionVersion?: string;
  connectivity?: ConnectivityResult;
  sessions?: BrowserSessionInfo[];
  profiles?: BrowserProfileStatus[];
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
    try {
      // Try a simple eval to verify end-to-end connectivity.
      await page.evaluate('1 + 1');
      await page.closeWindow?.();
    } finally {
      await bridge.close();
    }
    return { ok: true, durationMs: Date.now() - start };
  } catch (err) {
    return { ok: false, error: getErrorMessage(err), durationMs: Date.now() - start };
  }
}

export async function runBrowserDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  // Live connectivity check doubles as auto-start (bridge.connect spawns daemon).
  let connectivity: ConnectivityResult | undefined;
  if (opts.live) {
    connectivity = await checkConnectivity();
  } else {
    // No live probe — daemon may have idle-exited. Do a minimal auto-start
    // so we don't misreport a lazy-lifecycle stop as a real failure.
    const initialHealth = await getDaemonHealth();
    if (initialHealth.state === 'stopped') {
      try {
        const bridge = new BrowserBridge();
        await bridge.connect({ timeout: 5 });
        await bridge.close();
      } catch {
        // Auto-start failed; we'll report it below.
      }
    }
  }

  // Single status read *after* all side-effects (live check / auto-start) settle.
  const health = await getDaemonHealth();
  const daemonRunning = health.state !== 'stopped';
  const extensionConnected = health.state === 'ready';
  const daemonFlaky = !!(connectivity?.ok && !daemonRunning);
  const extensionFlaky = !!(connectivity?.ok && daemonRunning && !extensionConnected);
  const daemonStale = isDaemonStale(health.status, opts.cliVersion);
  const profiles = health.status?.profiles;
  let sessions: BrowserSessionInfo[] | undefined;
  if (opts.sessions) {
    if (profiles && profiles.length > 0) {
      const grouped = await Promise.all(profiles.map(async (profile) => {
        const rows = await listSessions({ contextId: profile.contextId }).catch(() => [] as BrowserSessionInfo[]);
        return rows.map((row) => ({ ...row, contextId: row.contextId ?? profile.contextId }));
      }));
      sessions = grouped.flat();
    } else if (health.state === 'ready') {
      sessions = await listSessions();
    }
  }
  const extensionVersion = health.status?.extensionVersion;

  const issues: string[] = [];
  if (daemonFlaky) {
    issues.push(
      'Daemon connectivity is unstable. The live browser test succeeded, but the daemon was no longer running immediately afterward.\n' +
      'This usually means the daemon crashed or exited right after serving the live probe.',
    );
  } else if (!daemonRunning) {
    issues.push('Daemon is not running. It should start automatically when you run an opencli browser command.');
  }
  if (daemonStale && opts.cliVersion) {
    issues.push(staleDaemonIssue(health.status, opts.cliVersion));
  }
  if (extensionFlaky) {
    issues.push(
      'Extension connection is unstable. The live browser test succeeded, but the daemon reported the extension disconnected immediately afterward.\n' +
      'This usually means the Browser Bridge service worker is reconnecting slowly or Chrome suspended it.',
    );
  } else if (daemonRunning && !extensionConnected) {
    if (health.state === 'profile-required') {
      issues.push(
        'Multiple Chrome profiles are connected to the daemon, but no default profile was selected.\n' +
        '  Run opencli profile list, then opencli profile use <name>, or pass --profile <name>.',
      );
    } else if (health.state === 'profile-disconnected') {
      issues.push(
        `Selected browser profile is not connected: ${health.status?.contextId ?? 'unknown'}.\n` +
        '  Open that Chrome profile and make sure the OpenCLI extension is enabled.',
      );
    } else {
      issues.push(
        'Daemon is running but the Chrome/Chromium extension is not connected.\n' +
        'If the extension is already installed, try: opencli daemon restart\n' +
        'If the extension is not installed:\n' +
        '  1. Download from https://github.com/jackwener/opencli/releases\n' +
        '  2. Open chrome://extensions/ → Enable Developer Mode\n' +
        '  3. Click "Load unpacked" → select the extension folder',
      );
    }
  }
  if (extensionConnected && !extensionVersion) {
    issues.push(
      'Extension is connected but did not report a version.\n' +
      '  This usually means an outdated Browser Bridge extension.\n' +
      '  Reload or reinstall the extension from: https://github.com/jackwener/opencli/releases',
    );
  }
  if (connectivity && !connectivity.ok) {
    issues.push(`Browser connectivity test failed: ${connectivity.error ?? 'unknown'}`);
  }
  const extensionCompatRange = health.status?.extensionCompatRange;
  if (extensionVersion && opts.cliVersion && extensionCompatRange) {
    if (!satisfiesRange(opts.cliVersion, extensionCompatRange)) {
      issues.push(
        `CLI version incompatible with extension: extension v${extensionVersion} requires CLI ${extensionCompatRange}, but CLI is v${opts.cliVersion}\n` +
        '  Update the CLI: npm install -g @jackwener/opencli\n' +
        '  Or download a compatible extension from: https://github.com/jackwener/opencli/releases',
      );
    }
  } else if (extensionVersion && opts.cliVersion) {
    // Fallback for older extensions that don't send compatRange
    const extMajor = extensionVersion.split('.')[0];
    const cliMajor = opts.cliVersion.split('.')[0];
    if (extMajor !== cliMajor) {
      issues.push(
        `Extension major version mismatch: extension v${extensionVersion} ≠ CLI v${opts.cliVersion}\n` +
        '  Download the latest extension from: https://github.com/jackwener/opencli/releases',
      );
    }
  }

  // Extension update check (from cached background fetch)
  const latestExtensionVersion = getCachedLatestExtensionVersion();
  if (extensionVersion && latestExtensionVersion && isNewerVersion(latestExtensionVersion, extensionVersion)) {
    issues.push(
      `Extension update available: v${extensionVersion} → v${latestExtensionVersion}\n` +
      '  Download from: https://github.com/jackwener/opencli/releases',
    );
  }

  return {
    cliVersion: opts.cliVersion,
    daemonRunning,
    daemonFlaky,
    daemonStale,
    daemonVersion: health.status?.daemonVersion,
    extensionConnected,
    extensionFlaky,
    extensionVersion,
    latestExtensionVersion,
    connectivity,
    sessions,
    profiles,
    issues,
  };
}

export function renderBrowserDoctorReport(report: DoctorReport): string {
  const lines = [styleText('bold', `opencli v${report.cliVersion ?? 'unknown'} doctor`) + styleText('dim', ` (${getRuntimeLabel()})`), ''];

  // Daemon status
  const daemonIcon = report.daemonFlaky
    ? styleText('yellow', '[WARN]')
    : report.daemonStale
      ? styleText('yellow', '[WARN]')
      : report.daemonRunning ? styleText('green', '[OK]') : styleText('red', '[MISSING]');
  const daemonLabel = report.daemonFlaky
    ? 'unstable (running during live check, then stopped)'
    : report.daemonRunning
      ? `running on port ${DEFAULT_DAEMON_PORT} (${report.daemonStale
        ? `${formatDaemonVersion(report)}, stale; CLI v${report.cliVersion ?? 'unknown'}`
        : formatDaemonVersion(report)})`
      : 'not running';
  lines.push(`${daemonIcon} Daemon: ${daemonLabel}`);

  // Extension status
  const extIcon = report.extensionFlaky || (report.extensionConnected && !report.extensionVersion)
    ? styleText('yellow', '[WARN]')
    : report.extensionConnected ? styleText('green', '[OK]') : styleText('yellow', '[MISSING]');
  const extUpdateHint = report.extensionVersion && report.latestExtensionVersion && isNewerVersion(report.latestExtensionVersion, report.extensionVersion)
    ? styleText('yellow', ` → v${report.latestExtensionVersion} available`)
    : '';
  const extVersion = !report.extensionConnected
    ? ''
    : report.extensionVersion
      ? styleText('dim', ` (v${report.extensionVersion})`) + extUpdateHint
      : styleText('dim', ' (version unknown)');
  const extLabel = report.extensionFlaky
    ? 'unstable (connected during live check, then disconnected)'
    : report.extensionConnected ? 'connected' : 'not connected';
  lines.push(`${extIcon} Extension: ${extLabel}${extVersion}`);

  if (report.profiles && report.profiles.length > 0) {
    const config = loadProfileConfig();
    lines.push('', styleText('bold', 'Profiles:'));
    for (const profile of report.profiles) {
      const alias = aliasForContextId(config, profile.contextId);
      const aliasText = alias ? ` (${alias})` : '';
      const defaultText = config.defaultContextId === profile.contextId ? ', default' : '';
      const version = profile.extensionVersion ? `v${profile.extensionVersion}` : 'version unknown';
      lines.push(styleText('dim', `  • ${profile.contextId}${aliasText}: connected ${version}${defaultText}`));
    }
  }

  // Connectivity
  if (report.connectivity) {
    const connIcon = report.connectivity.ok ? styleText('green', '[OK]') : styleText('red', '[FAIL]');
    const detail = report.connectivity.ok
      ? `connected in ${(report.connectivity.durationMs / 1000).toFixed(1)}s`
      : `failed (${report.connectivity.error ?? 'unknown'})`;
    lines.push(`${connIcon} Connectivity: ${detail}`);
  } else {
    lines.push(`${styleText('dim', '[SKIP]')} Connectivity: skipped (--no-live)`);
  }

  if (report.sessions) {
    lines.push('', styleText('bold', 'Sessions:'));
    if (report.sessions.length === 0) {
      lines.push(styleText('dim', '  • no active automation sessions'));
    } else {
      const byContext = new Map<string, BrowserSessionInfo[]>();
      for (const session of report.sessions) {
        const contextId = typeof session.contextId === 'string' && session.contextId ? session.contextId : 'default';
        const rows = byContext.get(contextId) ?? [];
        rows.push(session);
        byContext.set(contextId, rows);
      }
      for (const [contextId, rows] of byContext) {
        if (byContext.size > 1) lines.push(styleText('dim', `  [profile: ${contextId}]`));
        for (const session of rows) {
        const idle = session.idleMsRemaining == null
          ? 'none'
          : `${Math.ceil(session.idleMsRemaining / 1000)}s`;
        const target = session.preferredTabId != null
          ? `tab ${session.preferredTabId}`
          : `window ${session.windowId ?? 'unknown'}`;
        const mode = session.ownership ?? (session.owned === false ? 'borrowed' : 'owned');
        const surface = session.surface ? `, surface=${session.surface}` : '';
        lines.push(styleText('dim', `  • ${session.workspace ?? 'default'} → ${target}, mode=${mode}${surface}, tabs=${session.tabCount ?? 0}, idle=${idle}`));
      }
      }
    }
  }

  if (report.issues.length) {
    lines.push('', styleText('yellow', 'Issues:'));
    for (const issue of report.issues) {
      lines.push(styleText('dim', `  • ${issue}`));
    }
  } else if (report.daemonRunning && report.extensionConnected) {
    lines.push('', styleText('green', 'Everything looks good!'));
  }

  return lines.join('\n');
}
