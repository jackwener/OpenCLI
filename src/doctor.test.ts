import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDaemonHealth, mockConnect, mockClose, mockFindShadowedUserAdapters } = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockFindShadowedUserAdapters: vi.fn(),
}));

vi.mock('./browser/daemon-client.js', () => ({
  getDaemonHealth: mockGetDaemonHealth,
}));

vi.mock('./browser/index.js', () => ({
  BrowserBridge: class {
    connect = mockConnect;
    close = mockClose;
  },
}));

vi.mock('./adapter-shadow.js', async () => {
  const actual = await vi.importActual<typeof import('./adapter-shadow.js')>('./adapter-shadow.js');
  return {
    ...actual,
    findShadowedUserAdapters: mockFindShadowedUserAdapters,
  };
});

import { renderBrowserDoctorReport, runBrowserDoctor } from './doctor.js';

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  beforeEach(() => {
    vi.clearAllMocks();
    mockFindShadowedUserAdapters.mockReturnValue([]);
    // Doctor always runs live connectivity. Tests that want connect to fail override.
    mockConnect.mockResolvedValue({
      evaluate: vi.fn().mockResolvedValue(2),
      closeWindow: vi.fn().mockResolvedValue(undefined),
    });
    mockClose.mockResolvedValue(undefined);
  });

  it('renders OK-style report when daemon and extension connected', () => {
    const text = strip(renderBrowserDoctorReport({
      cliVersion: '1.7.9',
      daemonRunning: true,
      daemonVersion: '1.7.9',
      extensionConnected: true,
      extensionVersion: '1.6.8',
      issues: [],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('(v1.7.9)');
    expect(text).toContain('[OK] Extension: connected (v1.6.8)');
    expect(text).toContain('Everything looks good!');
    expect(text).not.toContain('opencli browser analyze <url>');
  });

  it('renders a warning when daemon version is stale', () => {
    const text = strip(renderBrowserDoctorReport({
      cliVersion: '1.7.9',
      daemonRunning: true,
      daemonVersion: '1.7.6',
      daemonStale: true,
      extensionConnected: true,
      extensionVersion: '1.0.3',
      issues: ['Stale daemon detected: daemon v1.7.6 != CLI v1.7.9.\n  Run: opencli daemon restart'],
    }));

    expect(text).toContain('[WARN] Daemon: running on port 19825 (v1.7.6, stale; CLI v1.7.9)');
    expect(text).toContain('Run: opencli daemon restart');
    expect(text).not.toContain('Everything looks good!');
  });

  it('renders MISSING when daemon not running', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: false,
      extensionConnected: false,
      issues: ['Daemon is not running.'],
    }));

    expect(text).toContain('[MISSING] Daemon: not running');
    expect(text).toContain('[MISSING] Extension: not connected');
    expect(text).toContain('Daemon is not running.');
  });

  it('renders extension not connected when daemon is running', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: false,
      issues: ['Daemon is running but the Chrome extension is not connected.'],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('[MISSING] Extension: not connected');
  });

  it('renders a warning when the extension version is unknown', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      issues: ['Extension is connected but did not report a version.'],
    }));

    expect(text).toContain('[WARN] Extension: connected (version unknown)');
    expect(text).toContain('Extension is connected but did not report a version.');
    expect(text).not.toContain('Everything looks good!');
  });

  it('renders connectivity OK when live test succeeds', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      connectivity: { ok: true, durationMs: 1234 },
      issues: [],
    }));

    expect(text).toContain('[OK] Connectivity: connected in 1.2s');
  });

  it('renders connected profiles when multiple are present', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: false,
      profiles: [
        { contextId: 'work', extensionConnected: true, extensionVersion: '1.2.3', pending: 0 },
        { contextId: 'personal', extensionConnected: true, extensionVersion: '1.2.3', pending: 0 },
      ],
      issues: [],
    }));

    expect(text).toContain('Profiles:');
    expect(text).toContain('work: connected v1.2.3');
    expect(text).toContain('personal: connected v1.2.3');
  });

  it('renders unstable extension state when live connectivity and status disagree', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      extensionFlaky: true,
      connectivity: { ok: true, durationMs: 1234 },
      issues: ['Extension connection is unstable.'],
    }));

    expect(text).toContain('[WARN] Extension: unstable');
    expect(text).toContain('Extension connection is unstable.');
  });

  it('renders unstable daemon state when live connectivity and status disagree', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: false,
      daemonFlaky: true,
      extensionConnected: false,
      connectivity: { ok: true, durationMs: 1234 },
      issues: ['Daemon connectivity is unstable.'],
    }));

    expect(text).toContain('[WARN] Daemon: unstable');
    expect(text).toContain('Daemon connectivity is unstable.');
  });

  it('reports daemon not running when connectivity fails and daemon stays stopped', async () => {
    mockConnect.mockRejectedValueOnce(new Error('Could not start daemon'));
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(false);
    expect(report.extensionConnected).toBe(false);
    expect(report.connectivity?.ok).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon is not running'),
    ]));
  });

  it('reports flapping when live check succeeds but final status shows extension disconnected', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(false);
    expect(report.extensionFlaky).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Extension connection is unstable'),
    ]));
  });

  it('reports daemon flapping when live check succeeds but daemon disappears afterward', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor();

    expect(report.daemonRunning).toBe(false);
    expect(report.daemonFlaky).toBe(true);
    expect(report.extensionConnected).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon connectivity is unstable'),
    ]));
  });

  it('uses the fast default timeout for live connectivity checks', async () => {
    let timeoutSeen: number | undefined;
    const closeWindow = vi.fn().mockResolvedValue(undefined);
    mockConnect.mockImplementationOnce(async (opts?: { timeout?: number }) => {
      timeoutSeen = opts?.timeout;
      return {
        evaluate: vi.fn().mockResolvedValue(2),
        closeWindow,
      };
    });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { extensionConnected: true } });

    await runBrowserDoctor();

    expect(timeoutSeen).toBe(8);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('reports an issue when the extension is connected but does not report a version', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        extensionConnected: true,
        extensionVersion: undefined,
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);

    const report = await runBrowserDoctor();

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('did not report a version'),
    ]));
  });

  it('reports an issue when daemon version differs from CLI version', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        daemonVersion: '1.7.6',
        extensionConnected: true,
        extensionVersion: '1.0.3',
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.daemonStale).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Stale daemon detected: daemon v1.7.6 != CLI v1.7.9'),
    ]));
  });

  it('reports local adapter shadows as a warning issue', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        daemonVersion: '1.7.9',
        extensionConnected: true,
        extensionVersion: '1.0.3',
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);
    mockFindShadowedUserAdapters.mockReturnValueOnce([
      {
        name: 'instagram/saved',
        userPath: '/home/me/.opencli/clis/instagram/saved.js',
        builtinPath: '/pkg/clis/instagram/saved.js',
      },
    ]);

    const report = await runBrowserDoctor({ cliVersion: '1.7.9' });

    expect(report.adapterShadows).toHaveLength(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Local adapter overrides shadow packaged adapters'),
    ]));
  });

  it('reports profile-required when multiple profiles are connected without a selection', async () => {
    const status = {
      state: 'profile-required' as const,
      status: {
        extensionConnected: false,
        profileRequired: true,
        profiles: [
          { contextId: 'work', extensionConnected: true, pending: 0 },
          { contextId: 'personal', extensionConnected: true, pending: 0 },
        ],
      },
    };
    mockGetDaemonHealth.mockResolvedValue(status);
    // Real connectivity would fail in profile-required state; force it here so
    // the test exercises the profile-required issue path, not the flaky path.
    mockConnect.mockRejectedValueOnce(new Error('profile required'));

    const report = await runBrowserDoctor();

    expect(report.profiles).toHaveLength(2);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Multiple Chrome profiles are connected'),
    ]));
  });
});
