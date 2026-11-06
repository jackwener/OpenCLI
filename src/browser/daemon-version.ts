import type { DaemonStatus } from './daemon-transport.js';

type ParsedVersion = { core: [number, number, number]; prerelease: string[] };

function parseVersion(version: string): ParsedVersion | null {
  const match = version.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

/** Semver precedence: negative when a < b, 0 when equal, null when either is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return null;
  for (let i = 0; i < 3; i++) {
    if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  }
  // A release outranks its prereleases (2.1.0 > 2.1.0-beta.1).
  if (!va.prerelease.length || !vb.prerelease.length) return vb.prerelease.length - va.prerelease.length;
  for (let i = 0; i < Math.max(va.prerelease.length, vb.prerelease.length); i++) {
    const pa = va.prerelease[i];
    const pb = vb.prerelease[i];
    if (pa === undefined) return -1;
    if (pb === undefined) return 1;
    if (pa === pb) continue;
    const na = /^\d+$/.test(pa) ? Number(pa) : null;
    const nb = /^\d+$/.test(pb) ? Number(pb) : null;
    if (na !== null && nb !== null) return na - nb;
    if (na !== null) return -1;
    if (nb !== null) return 1;
    return pa < pb ? -1 : 1;
  }
  return 0;
}

/**
 * Whether the running daemon should be replaced by this CLI's daemon.
 *
 * Only a daemon OLDER than the CLI (or too old to report a version) is stale.
 * A newer daemon is kept: its HTTP surface has only ever been extended (1.8.6
 * to 2.0.x is purely additive), so it still serves an older CLI. With exact
 * matching, two CLIs sharing the fixed port (e.g. OpenCLIApp's bundled CLI and
 * a global install, #2761) killed each other's daemon on every request; with
 * this rule they converge on the newest one. Unparseable versions fall back
 * to exact matching.
 */
export function isDaemonStale(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined, cliVersion?: string): boolean {
  if (!status || !cliVersion) return false;
  if (!status.daemonVersion) return true;
  const cmp = compareVersions(status.daemonVersion, cliVersion);
  return cmp === null ? status.daemonVersion !== cliVersion : cmp < 0;
}

export function formatDaemonVersion(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined): string {
  return status?.daemonVersion ? `v${status.daemonVersion}` : 'version unknown';
}

export function staleDaemonIssue(status: Pick<DaemonStatus, 'daemonVersion'> | null | undefined, cliVersion: string): string {
  return `Stale daemon detected: daemon ${formatDaemonVersion(status)} != CLI v${cliVersion}.\n` +
    '  Run: opencli daemon restart';
}
