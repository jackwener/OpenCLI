import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchDaemonStatus,
  getDaemonHealth,
  isDaemonRunning,
  requestDaemonShutdown,
} from './daemon-client.js';

describe('daemon-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchDaemonStatus sends the shared status request and returns parsed data', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      extensionConnected: true,
      extensionVersion: '1.2.3',
      pending: 0,
      lastCliRequestTime: Date.now(),
      memoryMB: 32,
      port: 19825,
    };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(fetchDaemonStatus()).resolves.toEqual(status);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/status$/),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-OpenCLI': '1' }),
      }),
    );
  });

  it('fetchDaemonStatus returns null on network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchDaemonStatus()).resolves.toBeNull();
  });

  it('requestDaemonShutdown POSTs to the shared shutdown endpoint', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({ ok: true } as Response);

    await expect(requestDaemonShutdown()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/shutdown$/),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-OpenCLI': '1' }),
      }),
    );
  });

  it('isDaemonRunning reflects shared status availability', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          pid: 123,
          uptime: 10,
          extensionConnected: false,
          pending: 0,
          lastCliRequestTime: Date.now(),
          memoryMB: 16,
          port: 19825,
        }),
    } as Response);

    await expect(isDaemonRunning()).resolves.toBe(true);
  });

  it('getDaemonHealth returns stopped when daemon is unreachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    const health = await getDaemonHealth();
    expect(health.state).toBe('stopped');
    expect(health.status).toBeNull();
  });

  it('getDaemonHealth returns no-extension when daemon runs without extension', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          pid: 123,
          uptime: 10,
          extensionConnected: false,
          pending: 0,
          lastCliRequestTime: Date.now(),
          memoryMB: 16,
          port: 19825,
        }),
    } as Response);

    const health = await getDaemonHealth();
    expect(health.state).toBe('no-extension');
    expect(health.status).not.toBeNull();
    expect(health.status!.extensionConnected).toBe(false);
  });

  it('getDaemonHealth returns ready when everything is connected', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          pid: 123,
          uptime: 10,
          extensionConnected: true,
          extensionVersion: '1.6.0',
          pending: 0,
          lastCliRequestTime: Date.now(),
          memoryMB: 16,
          port: 19825,
        }),
    } as Response);

    const health = await getDaemonHealth();
    expect(health.state).toBe('ready');
    expect(health.status!.extensionConnected).toBe(true);
    expect(health.status!.extensionVersion).toBe('1.6.0');
  });
});
