/**
 * CLI commands for daemon lifecycle:
 *   opencli daemon status — show daemon state
 *   opencli daemon stop   — graceful shutdown
 */

import { styleText } from 'node:util';
import { fetchDaemonStatus, requestDaemonShutdown } from '../browser/daemon-client.js';
import { formatDuration } from '../download/progress.js';
import { log } from '../logger.js';

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

  console.log(`Daemon: ${styleText('green', 'running')} (PID ${status.pid})`);
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
