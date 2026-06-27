import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BrowserCommandError,
  fetchDaemonStatus,
  getDaemonHealth,
  requestDaemonShutdown,
  sendCommand,
} from './daemon-client.js';
import * as daemonLifecycle from './daemon-lifecycle.js';

describe('daemon-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('fetchDaemonStatus sends the shared status request and returns parsed data', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      extensionConnected: true,
      extensionVersion: '1.2.3',
      pending: 0,
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

  it('getDaemonHealth returns stopped when daemon is not reachable', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'stopped', status: null });
  });

  it('getDaemonHealth returns no-extension when daemon is running but extension disconnected', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      extensionConnected: false,
      pending: 0,
      memoryMB: 16,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'no-extension', status });
  });

  it('getDaemonHealth returns ready when daemon and extension are both connected', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      extensionConnected: true,
      extensionVersion: '1.2.3',
      pending: 0,
      memoryMB: 32,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'ready', status });
  });

  it('getDaemonHealth returns profile-required when multiple profiles are connected without a selection', async () => {
    const status = {
      ok: true,
      pid: 123,
      uptime: 10,
      extensionConnected: false,
      profileRequired: true,
      profiles: [
        { contextId: 'work', extensionConnected: true, pending: 0 },
        { contextId: 'personal', extensionConnected: true, pending: 0 },
      ],
      pending: 0,
      memoryMB: 32,
      port: 19825,
    };
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(status),
    } as Response);

    await expect(getDaemonHealth()).resolves.toEqual({ state: 'profile-required', status });
  });

  it('fetchDaemonStatus includes contextId in the status query', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        pid: 1,
        uptime: 0,
        extensionConnected: true,
        pending: 0,
        memoryMB: 1,
        port: 19825,
      }),
    } as Response);

    await fetchDaemonStatus({ contextId: 'work' });

    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/\/status\?contextId=work$/);
  });

  it('rejects OPENCLI_DAEMON_PORT so CLI and extension cannot split bridge ports', async () => {
    vi.resetModules();
    vi.stubEnv('OPENCLI_DAEMON_PORT', '19999');
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        pid: 1,
        uptime: 0,
        extensionConnected: true,
        pending: 0,
        memoryMB: 1,
        port: 19825,
      }),
    } as Response);

    const freshClient = await import('./daemon-client.js');
    await expect(freshClient.fetchDaemonStatus()).rejects.toThrow('OPENCLI_DAEMON_PORT is no longer supported');

    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('sendCommand includes the current pid in generated command ids', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await expect(sendCommand('exec', { code: '1 + 1' })).resolves.toBe('ok');
    await expect(sendCommand('exec', { code: '2 + 2' })).resolves.toBe('ok');

    const ids = vi.mocked(fetch).mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return body.id;
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(new RegExp(`^cmd_${process.pid}_1763000000000_\\d+$`));
    expect(ids[1]).toMatch(new RegExp(`^cmd_${process.pid}_1763000000000_\\d+$`));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sendCommand forwards OPENCLI_PROFILE as command contextId', async () => {
    vi.stubEnv('OPENCLI_PROFILE', 'work');
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_000);
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await sendCommand('exec', { code: '1 + 1' });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as { contextId?: string };
    expect(body.contextId).toBe('work');
  });

  it('sendCommand uses explicit windowMode before OPENCLI_WINDOW env fallback', async () => {
    vi.stubEnv('OPENCLI_WINDOW', 'foreground');
    vi.mocked(fetch).mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
    } as Response);

    await sendCommand('exec', { code: '1 + 1', windowMode: 'background' });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)) as { windowMode?: string };
    expect(body.windowMode).toBe('background');
  });

  it('sendCommand retries with a new id when daemon reports a duplicate pending id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_123);
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ ok: false, error: 'Duplicate command id already pending; retry' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'server', ok: true, data: 42 }),
      } as Response);

    await expect(sendCommand('exec', { code: '6 * 7' })).resolves.toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const ids = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return body.id;
    });
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sendCommand does not retry command_result_unknown even when the message looks transient', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({
        id: 'server',
        ok: false,
        errorCode: 'command_result_unknown',
        error: 'Extension disconnected after command timeout',
        errorHint: 'Inspect state before retrying.',
      }),
    } as Response);

    await expect(sendCommand('exec', { code: 'window.__mutate = true' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
      hint: 'Inspect state before retrying.',
    } satisfies Partial<BrowserCommandError>);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendCommand runs full bridge ensure on a pre-dispatch failure, then resends with a fresh id', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_763_000_000_321);
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady').mockResolvedValue({
      health: {
        state: 'ready',
        status: {
          ok: true,
          pid: 1,
          uptime: 1,
          extensionConnected: true,
          pending: 0,
          memoryMB: 0,
          port: 19825,
        },
      },
      spawnedProcess: null,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: () => Promise.resolve({
          ok: false,
          errorCode: 'extension_not_connected',
          error: 'Extension not connected.',
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'server', ok: true, data: 7 }),
      } as Response);

    await expect(sendCommand('exec', { code: '1 + 6', contextId: 'work' })).resolves.toBe(7);

    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ contextId: 'work', verbose: false }));
    const ids = fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('sendCommand runs full bridge ensure on a local TypeError before resending', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady').mockResolvedValue({
      health: {
        state: 'ready',
        status: {
          ok: true,
          pid: 1,
          uptime: 1,
          extensionConnected: true,
          pending: 0,
          memoryMB: 0,
          port: 19825,
        },
      },
      spawnedProcess: null,
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ id: 'server', ok: true, data: 'ok' }),
      } as Response);

    await expect(sendCommand('exec', { code: 'document.title' })).resolves.toBe('ok');

    expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ verbose: false }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sendCommand does NOT wait when the bridge reports profile_required', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: () => Promise.resolve({
        ok: false,
        errorCode: 'profile_required',
        error: 'Multiple Browser Bridge profiles are connected; choose one with --profile.',
        errorHint: 'Run opencli profile list, then opencli profile use <name>.',
      }),
    } as Response);

    await expect(sendCommand('exec', { code: '1' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'profile_required',
    } satisfies Partial<BrowserCommandError>);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sendCommand surfaces an AbortError as command_result_unknown without ensure or resend', async () => {
    const ensureSpy = vi.spyOn(daemonLifecycle, 'ensureBrowserBridgeReady');
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    vi.mocked(fetch).mockRejectedValueOnce(abortErr);

    await expect(sendCommand('exec', { code: 'window.__mutate = true' })).rejects.toMatchObject({
      name: 'BrowserCommandError',
      code: 'command_result_unknown',
    } satisfies Partial<BrowserCommandError>);

    expect(ensureSpy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
