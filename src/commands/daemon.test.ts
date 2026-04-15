import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchDaemonStatusMock,
  requestDaemonShutdownMock,
} = vi.hoisted(() => ({
  fetchDaemonStatusMock: vi.fn(),
  requestDaemonShutdownMock: vi.fn(),
}));

vi.mock('../browser/daemon-client.js', () => ({
  fetchDaemonStatus: fetchDaemonStatusMock,
  requestDaemonShutdown: requestDaemonShutdownMock,
}));

import { daemonStatus, daemonStop } from './daemon.js';

describe('daemonStatus', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports "not running" when daemon is unreachable', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('shows daemon info when running', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 3661,
      extensionConnected: true,
      extensionVersion: '1.6.8',
      pending: 0,
      memoryMB: 64,
      port: 19825,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('1h 1m'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('connected'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('v1.6.8'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('64 MB'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('19825'));
  });

  it('shows disconnected when extension is not connected', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 99,
      uptime: 120,
      extensionConnected: false,
      pending: 0,
      memoryMB: 32,
      port: 19825,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
  });

  it('shows version unknown when the connected extension does not report one', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 99,
      uptime: 120,
      extensionConnected: true,
      extensionVersion: undefined,
      pending: 0,
      memoryMB: 32,
      port: 19825,
    });

    await daemonStatus();

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('version unknown'));
  });
});

describe('daemonStop', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports "not running" when daemon is unreachable', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);

    await daemonStop();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('sends shutdown and reports success', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      extensionConnected: true,
      pending: 0,
      memoryMB: 50,
      port: 19825,
    });
    requestDaemonShutdownMock.mockResolvedValue(true);

    await daemonStop();

    expect(requestDaemonShutdownMock).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
  });

  it('reports failure when shutdown request fails', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 100,
      extensionConnected: true,
      pending: 0,
      memoryMB: 50,
      port: 19825,
    });
    requestDaemonShutdownMock.mockResolvedValue(false);

    await daemonStop();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'));
  });
});
