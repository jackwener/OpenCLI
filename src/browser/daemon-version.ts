import type { DaemonStatus } from './daemon-transport.js';

type Versioned = Pick<DaemonStatus, 'hostVersion'> | { hostVersion?: string } | null | undefined;

function versionOf(status: Versioned): string | undefined {
  return status?.hostVersion;
}

export function isDaemonStale(status: Versioned, cliVersion?: string): boolean {
  if (!status || !cliVersion) return false;
  const version = versionOf(status);
  return !version || version !== cliVersion;
}

export function formatDaemonVersion(status: Versioned): string {
  const version = versionOf(status);
  return version ? `v${version}` : 'version unknown';
}

export function staleDaemonIssue(status: Versioned, cliVersion: string): string {
  return `Stale host detected: host ${formatDaemonVersion(status)} != CLI v${cliVersion}.\n` +
    '  Reload the OpenCLI extension in chrome://extensions.';
}
