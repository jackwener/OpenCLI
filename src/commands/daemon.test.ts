import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { daemonStatus, daemonStop, daemonRestart } from './daemon.js';

describe('daemon commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockConnect.mockReset();
  });

  describe('daemonStatus', () => {
    it('shows "not running" when daemon is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('shows "not running" when daemon returns non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

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

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(status),
        }),
      );

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

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve(status),
        }),
      );

      await daemonStatus();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disconnected'));
    });
  });

  describe('daemonStop', () => {
    it('reports "not running" when daemon is unreachable', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await daemonStop();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
    });

    it('sends shutdown and reports success', async () => {
      const statusResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            pid: 12345,
            uptime: 100,
            extensionConnected: true,
            pending: 0,
            lastCliRequestTime: Date.now(),
            memoryMB: 50,
            port: 19825,
          }),
      };
      const shutdownResponse = { ok: true };

      const mockFetch = vi.fn()
        .mockResolvedValueOnce(statusResponse)
        .mockResolvedValueOnce(shutdownResponse);
      vi.stubGlobal('fetch', mockFetch);

      await daemonStop();

      // Verify shutdown was called with POST
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const shutdownCall = mockFetch.mock.calls[1];
      expect(shutdownCall[0]).toContain('/shutdown');
      expect(shutdownCall[1]).toMatchObject({ method: 'POST' });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon stopped'));
    });

    it('reports failure when shutdown request fails', async () => {
      const statusResponse = {
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            pid: 12345,
            uptime: 100,
            extensionConnected: true,
            pending: 0,
            lastCliRequestTime: Date.now(),
            memoryMB: 50,
            port: 19825,
          }),
      };
      const shutdownResponse = { ok: false };

      const mockFetch = vi.fn()
        .mockResolvedValueOnce(statusResponse)
        .mockResolvedValueOnce(shutdownResponse);
      vi.stubGlobal('fetch', mockFetch);

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
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));
      mockConnect.mockResolvedValue(undefined);

      await daemonRestart();

      expect(mockConnect).toHaveBeenCalledWith({ timeout: 10 });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon restarted'));
    });

    it('stops then starts when daemon is running', async () => {
      const mockFetch = vi.fn()
        // First call: fetchStatus in daemonRestart — daemon is running
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(statusData) })
        // Second call: requestShutdown — success
        .mockResolvedValueOnce({ ok: true })
        // Subsequent calls: polling fetchStatus until unreachable
        .mockRejectedValue(new Error('ECONNREFUSED'));

      vi.stubGlobal('fetch', mockFetch);
      mockConnect.mockResolvedValue(undefined);

      await daemonRestart();

      // Verify shutdown was called
      const shutdownCall = mockFetch.mock.calls[1];
      expect(shutdownCall[0]).toContain('/shutdown');
      expect(shutdownCall[1]).toMatchObject({ method: 'POST' });

      expect(mockConnect).toHaveBeenCalledWith({ timeout: 10 });
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Daemon restarted'));
    });

    it('aborts when shutdown fails', async () => {
      const mockFetch = vi.fn()
        // fetchStatus — daemon is running
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(statusData) })
        // requestShutdown — failure
        .mockResolvedValueOnce({ ok: false });

      vi.stubGlobal('fetch', mockFetch);

      await daemonRestart();

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to stop daemon'));
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });
});
