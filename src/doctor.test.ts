import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetDaemonHealth, mockListSessions, mockConnect, mockClose } = vi.hoisted(() => ({
  mockGetDaemonHealth: vi.fn(),
  mockListSessions: vi.fn(),
  mockConnect: vi.fn(),
  mockClose: vi.fn(),
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

import { renderBrowserDoctorReport, runBrowserDoctor } from './doctor.js';

describe('doctor report rendering', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders OK-style report when daemon and extension connected', () => {
    const text = strip(renderBrowserDoctorReport({
      daemonRunning: true,
      extensionConnected: true,
      issues: [],
    }));

    expect(text).toContain('[OK] Daemon: running on port 19825');
    expect(text).toContain('[OK] Extension: connected');
    expect(text).toContain('Everything looks good!');
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
    // no-live mode: getDaemonHealth called twice (initial check + final status)
    // Initial: stopped → triggers auto-start attempt
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });
    // Auto-start fails
    mockConnect.mockRejectedValueOnce(new Error('Could not start daemon'));
    // Final: still stopped
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor({ live: false });

    expect(report.daemonRunning).toBe(false);
    expect(report.extensionConnected).toBe(false);
    expect(mockGetDaemonHealth).toHaveBeenCalledTimes(2);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon is not running'),
    ]));
  });

  it('does not report extension patch-version mismatch within the same minor version', async () => {
    const status = { extensionConnected: true, extensionVersion: '1.6.5' };
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status });

    const report = await runBrowserDoctor({ live: false, cliVersion: '1.6.8' });

    expect(report.issues).not.toEqual(expect.arrayContaining([
      expect.stringContaining('Extension version mismatch'),
    ]));
  });

  it('reports extension version mismatch when the minor version differs', async () => {
    const status = { extensionConnected: true, extensionVersion: '1.5.5' };
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status });
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status });

    const report = await runBrowserDoctor({ live: false, cliVersion: '1.6.8' });

    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Extension version mismatch: extension v1.5.5 ≠ CLI v1.6.8'),
    ]));
  });

  it('reports flapping when live check succeeds but final status shows extension disconnected', async () => {
    // Live check succeeds
    mockConnect.mockResolvedValueOnce({
      evaluate: vi.fn().mockResolvedValue(2),
    });
    mockClose.mockResolvedValueOnce(undefined);
    // After live check, getDaemonHealth shows no-extension
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
    // Live check succeeds
    mockConnect.mockResolvedValueOnce({
      evaluate: vi.fn().mockResolvedValue(2),
    });
    mockClose.mockResolvedValueOnce(undefined);
    // After live check, getDaemonHealth shows stopped
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
    mockConnect.mockImplementationOnce(async (opts?: { timeout?: number }) => {
      timeoutSeen = opts?.timeout;
      return {
        evaluate: vi.fn().mockResolvedValue(2),
      };
    });
    mockClose.mockResolvedValueOnce(undefined);
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'ready', status: { extensionConnected: true } });

    await runBrowserDoctor({ live: true });

    expect(timeoutSeen).toBe(8);
  });

  it('skips auto-start in no-live mode when daemon is already running', async () => {
    // no-live mode but daemon already running (no-extension)
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });
    // Final status: same
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'no-extension', status: { extensionConnected: false } });

    const report = await runBrowserDoctor({ live: false });

    // Should NOT have tried auto-start since daemon was already running
    expect(mockConnect).not.toHaveBeenCalled();
    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(false);
  });
});
