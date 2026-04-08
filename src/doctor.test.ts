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

  it('reports daemon not running when health check returns stopped', async () => {
    // getDaemonHealth called once (no more double-check)
    mockGetDaemonHealth.mockResolvedValueOnce({ state: 'stopped', status: null });

    const report = await runBrowserDoctor({ live: false });

    expect(report.daemonRunning).toBe(false);
    expect(report.extensionConnected).toBe(false);
    // Only one getDaemonHealth call — no more double status check
    expect(mockGetDaemonHealth).toHaveBeenCalledTimes(1);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('Daemon is not running'),
    ]));
  });

  it('reports extension not connected when health is no-extension', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({
      state: 'no-extension',
      status: { extensionConnected: false, pid: 123, uptime: 10, ok: true, pending: 0, lastCliRequestTime: Date.now(), memoryMB: 16, port: 19825 },
    });

    const report = await runBrowserDoctor({ live: false });

    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('extension is not connected'),
    ]));
  });

  it('reports all OK when health is ready', async () => {
    mockGetDaemonHealth.mockResolvedValueOnce({
      state: 'ready',
      status: { extensionConnected: true, extensionVersion: '1.6.2', pid: 123, uptime: 10, ok: true, pending: 0, lastCliRequestTime: Date.now(), memoryMB: 16, port: 19825 },
    });

    const report = await runBrowserDoctor({ live: false });

    expect(report.daemonRunning).toBe(true);
    expect(report.extensionConnected).toBe(true);
    expect(report.extensionVersion).toBe('1.6.2');
    expect(report.issues).toHaveLength(0);
  });
});
