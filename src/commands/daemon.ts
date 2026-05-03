/**
 * CLI commands for daemon lifecycle:
 *   opencli daemon status — show daemon state
 *   opencli daemon stop   — graceful shutdown
 *   opencli daemon restart — graceful shutdown, then start a fresh daemon
 */

import { styleText } from 'node:util';
import { fetchDaemonStatus, requestDaemonShutdown } from '../browser/daemon-client.js';
import { restartDaemon } from '../browser/daemon-lifecycle.js';
import { formatDuration } from '../download/progress.js';
import { log } from '../logger.js';
import { PKG_VERSION } from '../version.js';
import { formatDaemonVersion, isDaemonStale } from '../browser/daemon-version.js';

export async function daemonStatus(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    console.log(`Daemon: ${styleText('dim', 'not running')}`);
    return;
  }

  const extensionLabel = !status.extensionConnected
    ? styleText('yellow', 'disconnected')
    : status.extensionVersion
      ? `${styleText('green', 'connected')} ${styleText('dim', `(v${status.extensionVersion})`)}`
      : `${styleText('yellow', 'connected')} ${styleText('dim', '(version unknown)')}`;

  const daemonVersion = formatDaemonVersion(status);
  const stale = isDaemonStale(status, PKG_VERSION);
  console.log(`Daemon: ${stale ? styleText('yellow', 'stale') : styleText('green', 'running')} (PID ${status.pid})`);
  console.log(`Version: ${daemonVersion}${stale ? styleText('yellow', ` (CLI v${PKG_VERSION}; run: opencli daemon restart)`) : ''}`);
  console.log(`Uptime: ${formatDuration(Math.round(status.uptime * 1000))}`);
  console.log(`Extension: ${extensionLabel}`);
  if (status.profiles && status.profiles.length > 0) {
    console.log(`Profiles: ${status.profiles.map((profile) => {
      const version = profile.extensionVersion ? ` v${profile.extensionVersion}` : '';
      return `${profile.contextId}${version}`;
    }).join(', ')}`);
  }
  console.log(`Memory: ${status.memoryMB} MB`);
  console.log(`Port: ${status.port}`);
}

export async function daemonStop(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) {
    log.info('Daemon is not running.');
    return;
  }

  const ok = await requestDaemonShutdown();
  if (ok) {
    log.success('Daemon stopped.');
  } else {
    log.error('Failed to stop daemon.');
    process.exitCode = 1;
  }
}

export async function daemonRestart(): Promise<void> {
  const before = await fetchDaemonStatus();
  if (before?.profiles && before.profiles.length > 0) {
    log.warn(`Restarting daemon will disconnect ${before.profiles.length} browser profile(s); the extension should reconnect automatically.`);
  }

  const result = await restartDaemon();
  if (!result.stopped) {
    log.error('Failed to stop daemon before restart.');
    process.exitCode = 1;
    return;
  }
  if (!result.status) {
    log.error('Daemon restart timed out before the new daemon reported status.');
    process.exitCode = 1;
    return;
  }

  const action = result.previousStatus ? 'restarted' : 'started';
  const version = formatDaemonVersion(result.status);
  log.success(`Daemon ${action} on port ${result.status.port} (${version}).`);
  if (result.status.extensionConnected) {
    const profiles = result.status.profiles?.length ?? 0;
    const profileText = profiles > 0 ? `; profiles connected: ${profiles}` : '';
    log.status(`Extension connected${profileText}.`);
  } else {
    log.warn('Daemon is running, but the Browser Bridge extension has not connected yet.');
  }
}
