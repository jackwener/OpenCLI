import { describe, expect, it } from 'vitest';
import {
  _extractLatestExtensionVersionFromReleases as extractLatestExtensionVersionFromReleases,
  _buildUpdateNotices as buildUpdateNotices,
  _computeDueChecks as computeDueChecks,
  _EXTENSION_STALE_MS as EXTENSION_STALE_MS,
  _CHECK_INTERVAL_MS as CHECK_INTERVAL_MS,
  _EXTENSION_RETRY_INTERVAL_MS as EXTENSION_RETRY_INTERVAL_MS,
} from './update-check.js';

describe('extractLatestExtensionVersionFromReleases', () => {
  it('reads the extension version from a versioned asset on a normal CLI release', () => {
    expect(
      extractLatestExtensionVersionFromReleases([
        {
          tag_name: 'v1.7.3',
          assets: [
            { name: 'opencli-extension.zip' },
            { name: 'opencli-extension-v1.0.2.zip' },
          ],
        },
      ]),
    ).toBe('1.0.2');
  });

  it('falls back to ext-v tags for extension-only releases', () => {
    expect(
      extractLatestExtensionVersionFromReleases([
        {
          tag_name: 'ext-v1.1.0',
          assets: [{ name: 'opencli-extension.zip' }],
        },
      ]),
    ).toBe('1.1.0');
  });

  it('returns undefined when no extension version source exists', () => {
    expect(
      extractLatestExtensionVersionFromReleases([
        {
          tag_name: 'v1.7.3',
          assets: [{ name: 'opencli-extension.zip' }],
        },
      ]),
    ).toBeUndefined();
  });
});

describe('buildUpdateNotices', () => {
  const now = 1_700_000_000_000;

  it('returns nothing when cache is empty', () => {
    expect(buildUpdateNotices({ cliVersion: '1.0.0', cache: null, now })).toEqual({});
  });

  it('emits a CLI notice when registry version is newer', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: { lastCheck: now, latestVersion: '1.0.1' },
      now,
    });
    expect(lines.cli).toContain('v1.0.0 → v1.0.1');
    expect(lines.extension).toBeUndefined();
  });

  it('emits an extension notice when current ext is older and cache is fresh', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: {
        lastCheck: now,
        latestVersion: '1.0.0',
        latestExtensionVersion: '2.1.0',
        currentExtensionVersion: '2.0.0',
        extensionLastSeenAt: now - 60_000,
      },
      now,
    });
    expect(lines.cli).toBeUndefined();
    expect(lines.extension).toContain('v2.0.0 → v2.1.0');
  });

  it('skips the extension notice when lastSeenAt is older than the stale window', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: {
        lastCheck: now,
        latestVersion: '1.0.0',
        latestExtensionVersion: '2.1.0',
        currentExtensionVersion: '2.0.0',
        extensionLastSeenAt: now - EXTENSION_STALE_MS - 1,
      },
      now,
    });
    expect(lines.extension).toBeUndefined();
  });

  it('skips the extension notice when current and latest are equal', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: {
        lastCheck: now,
        latestVersion: '1.0.0',
        latestExtensionVersion: '2.0.0',
        currentExtensionVersion: '2.0.0',
        extensionLastSeenAt: now,
      },
      now,
    });
    expect(lines.extension).toBeUndefined();
  });

  it('does not throw when cache has only daemon-written fields and no latestVersion', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: {
        currentExtensionVersion: '2.0.0',
        extensionLastSeenAt: now,
      },
      now,
    });
    expect(lines.cli).toBeUndefined();
    expect(lines.extension).toBeUndefined();
  });

  it('emits both notices when both are out of date', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: {
        lastCheck: now,
        latestVersion: '1.1.0',
        latestExtensionVersion: '2.1.0',
        currentExtensionVersion: '2.0.0',
        extensionLastSeenAt: now,
      },
      now,
    });
    expect(lines.cli).toContain('v1.0.0 → v1.1.0');
    expect(lines.extension).toContain('v2.0.0 → v2.1.0');
  });
});

describe('computeDueChecks', () => {
  const NOW = 1_700_000_000_000;

  it('runs both lookups when the cache is empty', () => {
    expect(computeDueChecks(null, NOW)).toEqual({ cli: true, extension: true });
  });

  it('skips both while each cooldown is still fresh', () => {
    const cache = { lastCheck: NOW - 1000, extLastCheck: NOW - 1000, extLastFetchOk: true };
    expect(computeDueChecks(cache, NOW)).toEqual({ cli: false, extension: false });
  });

  // The regression this file exists to guard: a failed extension lookup used to
  // stamp the shared `lastCheck`, so the next run returned early and the lookup
  // never retried. A failure must now come back within the retry window.
  it('retries the extension lookup within the hour after a failure', () => {
    const failed = { lastCheck: NOW, extLastCheck: NOW, extLastFetchOk: false };
    expect(computeDueChecks(failed, NOW + EXTENSION_RETRY_INTERVAL_MS - 1).extension).toBe(false);
    expect(computeDueChecks(failed, NOW + EXTENSION_RETRY_INTERVAL_MS).extension).toBe(true);
  });

  it('waits the full interval after a successful extension lookup', () => {
    const ok = { lastCheck: NOW, extLastCheck: NOW, extLastFetchOk: true };
    expect(computeDueChecks(ok, NOW + EXTENSION_RETRY_INTERVAL_MS).extension).toBe(false);
    expect(computeDueChecks(ok, NOW + CHECK_INTERVAL_MS).extension).toBe(true);
  });

  // A fresh npm check must not suppress the extension lookup, and vice versa —
  // that coupling was the root cause.
  it('gates the two lookups independently', () => {
    const cliFresh = { lastCheck: NOW, extLastCheck: NOW - CHECK_INTERVAL_MS, extLastFetchOk: true };
    expect(computeDueChecks(cliFresh, NOW)).toEqual({ cli: false, extension: true });

    const extFresh = { lastCheck: NOW - CHECK_INTERVAL_MS, extLastCheck: NOW, extLastFetchOk: true };
    expect(computeDueChecks(extFresh, NOW)).toEqual({ cli: true, extension: false });
  });

  // Caches written before this field existed (or by the daemon, which only
  // writes currentExtensionVersion/extensionLastSeenAt) must still trigger a
  // lookup rather than being treated as fresh.
  it('treats a legacy cache without extLastCheck as due', () => {
    const legacy = { lastCheck: NOW, latestVersion: '1.8.7', currentExtensionVersion: '1.0.23' };
    expect(computeDueChecks(legacy, NOW)).toEqual({ cli: false, extension: true });
  });
});
