import { describe, expect, it } from 'vitest';
import {
  _extractLatestExtensionVersionFromReleases as extractLatestExtensionVersionFromReleases,
  _buildUpdateNotices as buildUpdateNotices,
  _buildNpmInstallCommand as buildNpmInstallCommand,
  _inferOwningGlobalPrefix as inferOwningGlobalPrefix,
  _inferDefaultPrefixFromExecPath as inferDefaultPrefixFromExecPath,
  _inferDefaultPrefixFromEnv as inferDefaultPrefixFromEnv,
  _quoteShellArg as quoteShellArg,
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

  it('uses the install-command override in the CLI hint when provided', () => {
    const lines = buildUpdateNotices({
      cliVersion: '1.0.0',
      cache: { lastCheck: now, latestVersion: '1.0.1' },
      now,
      installCommand: "npm install -g --prefix '/custom/prefix' @jackwener/opencli",
    });
    expect(lines.cli).toContain("--prefix '/custom/prefix'");
  });
});

describe('buildNpmInstallCommand', () => {
  it('emits a bare command when prefixes match', () => {
    expect(
      buildNpmInstallCommand({
        owningPrefix: '/usr/local',
        defaultPrefix: '/usr/local',
      }),
    ).toBe('npm install -g @jackwener/opencli');
  });

  it('emits a bare command when owning prefix cannot be inferred (dev / source)', () => {
    expect(
      buildNpmInstallCommand({
        owningPrefix: null,
        defaultPrefix: '/usr/local',
      }),
    ).toBe('npm install -g @jackwener/opencli');
  });

  it('emits a bare command when default prefix cannot be inferred', () => {
    expect(
      buildNpmInstallCommand({
        owningPrefix: '/Users/me/.local/share/npm',
        defaultPrefix: null,
      }),
    ).toBe('npm install -g @jackwener/opencli');
  });

  it('injects --prefix when owning prefix differs from default (the silent-mismatch case)', () => {
    // Real-world reproduction: CLI installed under user-level prefix via
    // ~/.npmrc, but env NPM_CONFIG_PREFIX points to the brew-managed node
    // prefix, so a bare `npm install -g` would land somewhere PATH never
    // looks. Hint must call out the owning prefix explicitly.
    const cmd = buildNpmInstallCommand({
      owningPrefix: '/Users/me/.local/share/npm',
      defaultPrefix: '/opt/homebrew/Cellar/node@22/22.22.2_2',
    });
    expect(cmd).toBe("npm install -g --prefix '/Users/me/.local/share/npm' @jackwener/opencli");
  });

  it('treats prefixes that resolve to the same path as a match (trailing slash, dot)', () => {
    expect(
      buildNpmInstallCommand({
        owningPrefix: '/usr/local/',
        defaultPrefix: '/usr/local',
      }),
    ).toBe('npm install -g @jackwener/opencli');
    expect(
      buildNpmInstallCommand({
        owningPrefix: '/usr/local/./',
        defaultPrefix: '/usr/local',
      }),
    ).toBe('npm install -g @jackwener/opencli');
  });

  it('shell-quotes prefixes so copy-pasted hints cannot expand shell syntax on POSIX', () => {
    const cmd = buildNpmInstallCommand({
      owningPrefix: "/Users/me/npm $(touch bad) `touch worse` user's",
      defaultPrefix: '/opt/homebrew',
    });
    expect(cmd).toBe("npm install -g --prefix '/Users/me/npm $(touch bad) `touch worse` user'\\''s' @jackwener/opencli");
  });
});

describe('inferOwningGlobalPrefix', () => {
  it('returns the prefix above lib/node_modules for a standard POSIX npm global install', () => {
    expect(
      inferOwningGlobalPrefix(
        '/Users/me/.local/share/npm/lib/node_modules/@jackwener/opencli/dist/src/update-check.js',
      ),
    ).toBe('/Users/me/.local/share/npm');
  });

  it('returns the prefix above node_modules when there is no lib/ segment (e.g. Windows)', () => {
    expect(
      inferOwningGlobalPrefix(
        '/c/Users/me/AppData/Roaming/npm/node_modules/@jackwener/opencli/dist/src/update-check.js',
      ),
    ).toBe('/c/Users/me/AppData/Roaming/npm');
  });

  it('returns null when the module path is outside any node_modules/@jackwener/opencli (dev / source build)', () => {
    expect(
      inferOwningGlobalPrefix('/Users/me/code/opencli/src/update-check.ts'),
    ).toBeNull();
    expect(
      inferOwningGlobalPrefix('/Users/me/code/opencli/dist/src/update-check.js'),
    ).toBeNull();
  });
});

describe('inferDefaultPrefixFromExecPath', () => {
  it('strips the bin/ segment for a POSIX node binary', () => {
    expect(
      inferDefaultPrefixFromExecPath('/opt/homebrew/Cellar/node@22/22.22.2_2/bin/node'),
    ).toBe('/opt/homebrew/Cellar/node@22/22.22.2_2');
  });

  it('returns null on POSIX when the layout is non-standard (no bin/ parent)', () => {
    expect(
      inferDefaultPrefixFromExecPath('/some/weird/place/node'),
    ).toBeNull();
  });
});

describe('inferDefaultPrefixFromEnv', () => {
  it('prefers explicit npm prefix env because it controls bare npm install -g', () => {
    expect(
      inferDefaultPrefixFromEnv({
        NPM_CONFIG_PREFIX: '/tmp/npm-prefix',
      }),
    ).toBe('/tmp/npm-prefix');
    expect(
      inferDefaultPrefixFromEnv({
        npm_config_prefix: '/tmp/lower-prefix',
      }),
    ).toBe('/tmp/lower-prefix');
  });

  it('returns null when npm prefix env is absent or blank', () => {
    expect(inferDefaultPrefixFromEnv({})).toBeNull();
    expect(inferDefaultPrefixFromEnv({ NPM_CONFIG_PREFIX: '   ' })).toBeNull();
  });
});

describe('quoteShellArg', () => {
  it('uses single quotes on POSIX to prevent expansion of spaces, dollars, and backticks', () => {
    expect(quoteShellArg('/tmp/a b/$(touch x)/`touch y`', 'darwin')).toBe("'/tmp/a b/$(touch x)/`touch y`'");
    expect(quoteShellArg("/tmp/user's prefix", 'linux')).toBe("'/tmp/user'\\''s prefix'");
  });

  it('uses double quotes on Windows command hints', () => {
    expect(quoteShellArg('C:\\Users\\Me\\npm prefix', 'win32')).toBe('"C:\\Users\\Me\\npm prefix"');
  });
});
