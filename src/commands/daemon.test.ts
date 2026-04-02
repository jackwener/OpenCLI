import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  fetchDaemonStatusMock,
  requestDaemonShutdownMock,
} = vi.hoisted(() => ({
  fetchDaemonStatusMock: vi.fn(),
  requestDaemonShutdownMock: vi.fn(),
}));

vi.mock('chalk', () => ({
  default: {
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

const mockConnect = vi.fn();
vi.mock('../browser/bridge.js', () => ({
  BrowserBridge: class {
    connect = mockConnect;
  },
}));

vi.mock('../browser/daemon-client.js', () => ({
  fetchDaemonStatus: fetchDaemonStatusMock,
  requestDaemonShutdown: requestDaemonShutdownMock,
}));

import { daemonStatus, daemonStop, daemonRestart } from './daemon.js';

describe('daemon commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConnect.mockReset();
  });

  describe('daemonStatus', () => {
    it('shows "not running" when daemon is unreachable', async () => {
      fetchDaemonStatusMock.mockResolvedValue(null);

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('shows "not running" when daemon returns non-ok response', async () => {
      fetchDaemonStatusMock.mockResolvedValue(null);

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('shows daemon info when running', async () => {
      const status = {
        ok: true,
        pid: 12345,
        uptime: 3661,
        extensionConnected: true,
        pending: 0,
        lastCliRequestTime: Date.now() - 30_000,
        memoryMB: 64,
        port: 19825,
      };

      fetchDaemonStatusMock.mockResolvedValue(status);

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('running'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('PID 12345'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('1h 1m'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('connected'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('64 MB'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('19825'));
    });

    it('shows disconnected when extension is not connected', async () => {
      const status = {
        ok: true,
        pid: 99,
        uptime: 120,
        extensionConnected: false,
        pending: 0,
        lastCliRequestTime: Date.now() - 5000,
        memoryMB: 32,
        port: 19825,
      };

      fetchDaemonStatusMock.mockResolvedValue(status);

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
    });
  });

  describe('daemonStop', () => {
    it('reports "not running" when daemon is unreachable', async () => {
      fetchDaemonStatusMock.mockResolvedValue(null);

      await daemonStop();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('sends shutdown and reports success', async () => {
      fetchDaemonStatusMock.mockResolvedValue({
        ok: true,
        pid: 12345,
        uptime: 100,
        extensionConnected: true,
        pending: 0,
        lastCliRequestTime: Date.now(),
        memoryMB: 50,
        port: 19825,
      });
      requestDaemonShutdownMock.mockResolvedValue(true);

      await daemonStop();

      expect(requestDaemonShutdownMock).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
    });

    it('reports failure when shutdown request fails', async () => {
      fetchDaemonStatusMock.mockResolvedValue({
        ok: true,
        pid: 12345,
        uptime: 100,
        extensionConnected: true,
        pending: 0,
        lastCliRequestTime: Date.now(),
        memoryMB: 50,
        port: 19825,
      });
      requestDaemonShutdownMock.mockResolvedValue(false);

      await daemonStop();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'));
    });
  });

  describe('daemonRestart', () => {
    const statusData = {
      ok: true,
      pid: 12345,
      uptime: 100,
      extensionConnected: true,
      pending: 0,
      lastCliRequestTime: Date.now(),
      memoryMB: 50,
      port: 19825,
    };

    it('starts daemon directly when not running', async () => {
      fetchDaemonStatusMock.mockResolvedValue(null);
      mockConnect.mockResolvedValue(undefined);

      await daemonRestart();

      expect(mockConnect).toHaveBeenCalledWith({ timeout: 10 });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon restarted'));
    });

    it('stops then starts when daemon is running', async () => {
      fetchDaemonStatusMock
        .mockResolvedValueOnce(statusData)
        .mockResolvedValueOnce(null);
      requestDaemonShutdownMock.mockResolvedValue(true);
      mockConnect.mockResolvedValue(undefined);

      await daemonRestart();

      expect(requestDaemonShutdownMock).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledWith({ timeout: 10 });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon restarted'));
    });

    it('aborts when shutdown fails', async () => {
      fetchDaemonStatusMock.mockResolvedValue(statusData);
      requestDaemonShutdownMock.mockResolvedValue(false);

      await daemonRestart();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'));
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });
});
