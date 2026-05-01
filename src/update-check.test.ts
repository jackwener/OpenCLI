import { describe, expect, it } from 'vitest';
import {
  _extractLatestExtensionVersionFromReleases as extractLatestExtensionVersionFromReleases,
  _buildUpdateNotices as buildUpdateNotices,
  _EXTENSION_STALE_MS as EXTENSION_STALE_MS,
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
