import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDaemonHealth, mockListSessions, mockConnect, mockClose, mockFindShadowedUserAdapters } = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockListSessions: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
  mockFindShadowedUserAdapters: vi.fn(),
}));

vi.mock('./browser/daemon-client.js', () => ({
  getDaemonHealth: mockGetDaemonHealth,
  listSessions: mockListSessions,
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
    expect(text).toContain('opencli browser analyze <url>');
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
      issues: ['Daemon is running but the Chrome extension is not connected.\nTry running the command again — the extension may need a moment to reconnect.\nIf it still fails, reload OpenCLI in chrome://extensions and run: opencli daemon restart'],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('[MISSING] Extension: not connected');
    expect(text).toContain('Try running the command again');
    expect(text).toContain('reload OpenCLI in chrome://extensions');
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

  it('renders connectivity SKIP when not tested', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      issues: [],
    }));

    expect(text).toContain('[SKIP] Connectivity: skipped (--no-live)');
  });

  it('renders sessions with tab leases and no idle timer', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      issues: [],
      sessions: [
        {
          workspace: 'bound:default',
          windowId: 2,
          preferredTabId: 42,
          ownership: 'borrowed',
          surface: 'borrowed-user-tab',
          tabCount: 1,
          idleMsRemaining: null,
        },
      ],
    }));

    expect(text).toContain('bound:default → tab 42, mode=borrowed, surface=borrowed-user-tab, tabs=1, idle=none');
  });

  it('renders connected profiles and groups sessions by profile', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: false,
      profiles: [
        { contextId: 'work', extensionConnected: true, extensionVersion: '1.2.3', pending: 0 },
        { contextId: 'personal', extensionConnected: true, extensionVersion: '1.2.3', pending: 0 },
      ],
      issues: [],
      sessions: [
        {
          contextId: 'work',
          workspace: 'bound:default',
          windowId: 2,
          preferredTabId: 42,
          ownership: 'borrowed',
          surface: 'borrowed-user-tab',
          tabCount: 1,
          idleMsRemaining: null,
        },
        {
          contextId: 'personal',
          workspace: 'site:foo',
          windowId: 1,
          preferredTabId: 10,
          ownership: 'owned',
          surface: 'dedicated-container',
          tabCount: 1,
          idleMsRemaining: 1000,
        },
      ],
    }));

    expect(text).toContain('Profiles:');
    expect(text).toContain('work: connected v1.2.3');
    expect(text).toContain('[profile: work]');
    expect(text).toContain('[profile: personal]');
    expect(text).toContain('bound:default → tab 42');
    expect(text).toContain('site:foo → tab 10');
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

  it('reports daemon not running when no-live and auto-start fails', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });
    mockConnect.mockRejectedValueOnce(new Error('Could not start daemon'));
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor({ live: false });

    expect(report.daemonRunning).toBe(false);
    expect(report.extensionConnected).toBe(false);
    expect(mockGetDaemonHealth).toHaveBeenCalledTimes(2);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon is not running'),
    ]));
  });

  it('reports flapping when live check succeeds but final status shows extension disconnected', async () => {
    mockConnect.mockResolvedValueOnce({
      evaluate: vi.fn().mockResolvedValue(2),
    });
    mockClose.mockResolvedValueOnce(undefined);
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });

    const report = await runBrowserDoctor({ live: true });

    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(false);
    expect(report.extensionFlaky).toBe(true);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Extension connection is unstable'),
    ]));
  });

  it('reports daemon flapping when live check succeeds but daemon disappears afterward', async () => {
    mockConnect.mockResolvedValueOnce({
      evaluate: vi.fn().mockResolvedValue(2),
    });
    mockClose.mockResolvedValueOnce(undefined);
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor({ live: true });

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
    mockClose.mockResolvedValueOnce(undefined);
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { extensionConnected: true } });

    await runBrowserDoctor({ live: true });

    expect(timeoutSeen).toBe(8);
    expect(closeWindow).toHaveBeenCalledTimes(1);
  });

  it('skips auto-start in no-live mode when daemon is already running', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });

    const report = await runBrowserDoctor({ live: false });

    expect(mockConnect).not.toHaveBeenCalled();
    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(false);
  });

  it('reports an issue when the extension is connected but does not report a version', async () => {
    const status = {
      state: 'ready' as const,
      status: {
        extensionConnected: true,
        extensionVersion: undefined,
      },
    };
    mockGetDaemonHealth
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(status);

    const report = await runBrowserDoctor({ live: false });

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
    mockGetDaemonHealth
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(status);

    const report = await runBrowserDoctor({ live: false, cliVersion: '1.7.9' });

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
    mockGetDaemonHealth
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(status);
    mockFindShadowedUserAdapters.mockReturnValueOnce([
      {
        name: 'instagram/saved',
        userPath: '/home/me/.opencli/clis/instagram/saved.js',
        builtinPath: '/pkg/clis/instagram/saved.js',
      },
    ]);

    const report = await runBrowserDoctor({ live: false, cliVersion: '1.7.9' });

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
    mockGetDaemonHealth
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce(status);

    const report = await runBrowserDoctor({ live: false });

    expect(report.profiles).toHaveLength(2);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Multiple Chrome profiles are connected'),
    ]));
  });
});
