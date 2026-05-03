import type { DaemonStatus } from './daemon-client.js';

export function isDaemonStale(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined, cliVersion?: string): boolean {
  if (!status || !cliVersion) return false;
  return !status.daemonVersion || status.daemonVersion !== cliVersion;
}

export function formatDaemonVersion(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined): string {
  return status?.daemonVersion ? `v${status.daemonVersion}` : 'version unknown';
}

export function staleDaemonIssue(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined, cliVersion: string): string {
  return `Stale daemon detected: daemon ${formatDaemonVersion(status)} != CLI v${cliVersion}.\n` +
    '  Run: opencli daemon restart';
}
