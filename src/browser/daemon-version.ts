import type { DaemonStatus } from './daemon-transport.js';

function versionOf(status: Pick<DaemonStatus, 'daemonVersion' | 'hostVersion'> | null | undefined): string | undefined {
  return status?.hostVersion ?? status?.daemonVersion;
}

export function isDaemonStale(status: Pick<DaemonStatus, 'daemonVersion' | 'hostVersion'> | null | undefined, cliVersion?: string): boolean {
  if (!status || !cliVersion) return false;
  const version = versionOf(status);
  return !version || version !== cliVersion;
}

export function formatDaemonVersion(status: Pick<DaemonStatus, 'daemonVersion' | 'hostVersion'> | null | undefined): string {
  const version = versionOf(status);
  return version ? `v${version}` : 'version unknown';
}

export function staleDaemonIssue(status: Pick<DaemonStatus, 'daemonVersion' | 'hostVersion'> | null | undefined, cliVersion: string): string {
  return `Stale host detected: host ${formatDaemonVersion(status)} != CLI v${cliVersion}.\n` +
    '  Reload the OpenCLI extension in chrome://extensions.';
}
