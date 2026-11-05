import { describe, expect, it } from 'vitest';
import { compareVersions, isDaemonStale } from './daemon-version.js';

describe('compareVersions', () => {
  it('orders by semver precedence, including prereleases', () => {
    expect(compareVersions('1.8.6', '2.0.2')).toBeLessThan(0);
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('v2.0.2', '2.0.2')).toBe(0);
    expect(compareVersions('2.1.0-beta.1', '2.1.0')).toBeLessThan(0);
    expect(compareVersions('2.1.0-beta.2', '2.1.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('2.1.0-alpha', '2.1.0-beta')).toBeLessThan(0);
    expect(compareVersions('2.1.0-beta', '2.1.0-beta.1')).toBeLessThan(0);
  });

  it('returns null for unparseable versions', () => {
    expect(compareVersions('dev', '2.0.2')).toBeNull();
  });
});

describe('isDaemonStale', () => {
  it('replaces only daemons older than the CLI (#2761)', () => {
    // OpenCLIApp bundles 1.8.6, the global CLI is 2.0.x: only the newer side
    // may replace the older daemon, so the two converge instead of flip-flopping.
    expect(isDaemonStale({ daemonVersion: '1.8.6' }, '2.0.2')).toBe(true);
    expect(isDaemonStale({ daemonVersion: '2.0.2' }, '1.8.6')).toBe(false);
    expect(isDaemonStale({ daemonVersion: '2.0.2' }, '2.0.2')).toBe(false);
    expect(isDaemonStale({ daemonVersion: '2.1.0-beta.1' }, '2.1.0')).toBe(true);
  });

  it('treats pre-version daemons as stale and falls back to exact matching for unparseable versions', () => {
    expect(isDaemonStale({}, '2.0.2')).toBe(true);
    expect(isDaemonStale({ daemonVersion: 'dev' }, '2.0.2')).toBe(true);
    expect(isDaemonStale({ daemonVersion: 'dev' }, 'dev')).toBe(false);
  });

  it('never flags a missing daemon or unknown CLI version', () => {
    expect(isDaemonStale(null, '2.0.2')).toBe(false);
    expect(isDaemonStale({ daemonVersion: '1.0.0' }, undefined)).toBe(false);
  });
});
