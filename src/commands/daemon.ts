/** Structured daemon lifecycle commands. */
import { fetchDaemonStatus, requestDaemonShutdown } from '../browser/daemon-transport.js';
import { restartDaemon } from '../browser/daemon-lifecycle.js';
import { isDaemonStale } from '../browser/daemon-version.js';
import { emitFailure, emitResult } from '../command-output.js';
import { PKG_VERSION } from '../version.js';

export async function daemonStatus(): Promise<void> {
  const status = await fetchDaemonStatus();
  emitResult(status ? {
    ...status,
    running: true,
    stale: isDaemonStale(status, PKG_VERSION),
    ...(status.profileRequired || status.profileDisconnected
      ? { hint: 'Select a connected profile with opencli profile use <name>.' } : {}),
  } : { running: false });
}

export async function daemonStop(): Promise<void> {
  const status = await fetchDaemonStatus();
  if (!status) { emitResult({ running: false, stopped: false }); return; }
  if (!await requestDaemonShutdown()) {
    emitFailure({ code: 'daemon_stop_failed', message: 'Failed to stop daemon.' });
    return;
  }
  emitResult({ running: false, stopped: true });
}

export async function daemonRestart(): Promise<void> {
  const result = await restartDaemon();
  if (!result.stopped) {
    emitFailure({ code: 'daemon_stop_failed', message: 'Failed to stop daemon before restart.' });
    return;
  }
  if (!result.status) {
    emitFailure({ code: 'outcome_unknown', message: 'Daemon restart timed out before the new daemon reported status.',
      hint: 'Read opencli daemon status before retrying.' });
    return;
  }
  emitResult({ action: result.previousStatus ? 'restarted' : 'started', status: result.status });
}
