import { describe, expect, it } from 'vitest';

import { buildWslExtensionIssue, isWslEnvironment } from './wsl.js';

describe('isWslEnvironment', () => {
  it('detects WSL via WSL_DISTRO_NAME', () => {
    expect(isWslEnvironment({ env: { WSL_DISTRO_NAME: 'Ubuntu' }, platform: 'linux', procVersion: null })).toBe(true);
  });

  it('detects WSL via WSL_INTEROP', () => {
    expect(isWslEnvironment({ env: { WSL_INTEROP: '/run/WSL/123_interop' }, platform: 'linux', procVersion: null })).toBe(
      true,
    );
  });

  it('detects WSL via microsoft in /proc/version', () => {
    expect(
      isWslEnvironment({
        env: {},
        platform: 'linux',
        procVersion: 'Linux version 5.15.153.1-microsoft-standard-WSL2 (root@9417ed4f9bd0)',
      }),
    ).toBe(true);
  });

  it('detects WSL1 via microsoft in /proc/version (case-insensitive)', () => {
    expect(
      isWslEnvironment({
        env: {},
        platform: 'linux',
        procVersion: 'Linux version 4.4.0-19041-Microsoft (Microsoft@Microsoft.com)',
      }),
    ).toBe(true);
  });

  it('returns false on native linux without WSL markers', () => {
    expect(
      isWslEnvironment({
        env: { PATH: '/usr/bin' },
        platform: 'linux',
        procVersion: 'Linux version 6.8.0-52-generic (buildd@lcy02-amd64-101)',
      }),
    ).toBe(false);
  });

  it('returns false on healthy input when nothing indicates WSL', () => {
    expect(isWslEnvironment({ env: {}, platform: 'darwin', procVersion: null })).toBe(false);
  });

  it('ignores WSLENV on non-linux platforms', () => {
    // WSLENV can leak into Windows-side tooling; alone it must not
    // misclassify a native Windows/macOS run as WSL.
    expect(isWslEnvironment({ env: { WSLENV: 'FOO/up' }, platform: 'win32', procVersion: null })).toBe(false);
  });

  it('ignores WSLENV alone on linux', () => {
    // WSLENV is not a detector by itself: it can leak into native-Linux
    // environments via dotfiles or `docker run -e`. Real WSL guests always
    // carry a strong marker or a microsoft kernel.
    expect(isWslEnvironment({ env: { WSLENV: 'FOO/up' }, platform: 'linux', procVersion: null })).toBe(false);
  });

  it('ignores blank markers', () => {
    expect(
      isWslEnvironment({ env: { WSL_DISTRO_NAME: '   ', WSL_INTEROP: '' }, platform: 'linux', procVersion: null }),
    ).toBe(false);
  });

  it('falls back to live /proc/version without throwing', () => {
    // No injected procVersion: exercises the real readProcVersion path
    // (including its catch-null branch on non-linux test machines).
    expect(typeof isWslEnvironment({ env: {}, platform: 'linux' })).toBe('boolean');
  });
});

describe('buildWslExtensionIssue', () => {
  it('mentions networking mode, daemon restart, and the authenticated logs endpoint', () => {
    const issue = buildWslExtensionIssue();

    expect(issue).toContain('WSL');
    expect(issue).toContain('wslinfo --networking-mode');
    expect(issue).toContain('opencli daemon restart');
    // The daemon /logs endpoint requires the X-OpenCLI header; a bare
    // `curl localhost:19825/logs` answers 403 (GH #1565 follow-up).
    expect(issue).toContain('X-OpenCLI');
    // Pin the exact invocation, not just the keywords: port, header flag,
    // and path must all be right for the command to work.
    expect(issue).toContain('curl -H "X-OpenCLI: 1" "localhost:19825/logs"');
    expect(issue).toContain('wsl --shutdown');
  });
});
